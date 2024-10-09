const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const tus = require('tus-js-client');
const FormData = require('form-data');
const ethers = require('ethers');
const dotenv = require('dotenv');

const { ElevenLabsClient, ElevenLabs } = require("elevenlabs");
const path = require('path');

const { GALADRIEL_RPC_URL, GALADRIEL_CHAIN_ID, STORY_RPC_URL, STORY_CHAIN_ID, GALADRIEL_CONTRACT_ADDRESS, GALADRIEL_CONTRACT_ABI, STORY_CONTRACT_ADDRESS, STORY_CONTRACT_ABI, API_URL, AI_API_URL } = require('./constants');

// Load environment variables
dotenv.config();

const API_KEY = process.env.LIVEPEER_API_KEY;
const client = new ElevenLabsClient({ apiKey: process.env.ELEVENLABS_API_KEY });

// Initialize Ethers providers
const mnemonic = process.env.MNEMONIC;
const galadriel_provider = new ethers.providers.JsonRpcProvider(GALADRIEL_RPC_URL, GALADRIEL_CHAIN_ID);
const galadriel_signer = ethers.Wallet.fromMnemonic(mnemonic).connect(galadriel_provider);
const galadrielContract = new ethers.Contract(GALADRIEL_CONTRACT_ADDRESS, GALADRIEL_CONTRACT_ABI, galadriel_signer);

const story_provider = new ethers.providers.JsonRpcProvider(STORY_RPC_URL, STORY_CHAIN_ID);
const story_signer = ethers.Wallet.fromMnemonic(mnemonic).connect(story_provider);
const storyContract = new ethers.Contract(STORY_CONTRACT_ADDRESS, STORY_CONTRACT_ABI, story_signer);

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

async function generateAIImage(prompt, retryCount = 0) {
  try {
    const options = {
      method: 'POST',
      url: AI_API_URL,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model_id: "ByteDance/SDXL-Lightning",
        prompt: prompt,
        width: 1280,
        height: 720
      }
    };

    const response = await axios(options);
    return response.data;
  } catch (error) {
    console.error(`Error generating AI image (attempt ${retryCount + 1}):`, error.message);
    
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return generateAIImage(prompt, retryCount + 1);
    }
    
    throw error;
  }
}

async function downloadAIImage(imageUrl, filePath) {
  // Remove the incorrect part of the URL
  const correctedUrl = imageUrl.replace('https://dream-gateway.livepeer.cloud:', '');

  console.log(`Attempting to download from: ${correctedUrl}`);

  const writer = fs.createWriteStream(filePath);
  try {
    const response = await axios({
      url: correctedUrl,
      method: 'GET',
      responseType: 'stream'
    });
    response.data.pipe(writer);

    return new Promise((resolve, reject) => {
      writer.on('finish', () => {
        console.log(`Successfully downloaded to ${filePath}`);
        resolve();
      });
      writer.on('error', (err) => {
        console.error(`Error writing to file ${filePath}:`, err);
        reject(err);
      });
    });
  } catch (error) {
    console.error(`Error downloading from ${correctedUrl}:`, error.message);
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', error.response.headers);
    }
    throw error;
  }
}

function createVideoFromImages(imagePaths, outputPath, durations) {
  return new Promise((resolve, reject) => {
    const inputFiles = imagePaths.map((path, index) => `-loop 1 -t ${durations[index]} -i ${path}`).join(' ');
    const filterComplex = imagePaths.map((_, index) => `[${index}:v]scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2[v${index}];`).join('');
    const filterComplexConcat = imagePaths.map((_, index) => `[v${index}]`).join('') + `concat=n=${imagePaths.length}:v=1:a=0[outv]`;
    
    const command = `ffmpeg -y ${inputFiles} -filter_complex "${filterComplex}${filterComplexConcat}" -map "[outv]" -c:v libx264 -pix_fmt yuv420p ${outputPath}`;
    
    console.log('Executing ffmpeg command:', command);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing ffmpeg:', error);
        return reject(error);
      }
      if (stderr) {
        console.error('ffmpeg stderr:', stderr);
      }
      console.log('ffmpeg stdout:', stdout);
      
      if (fs.existsSync(outputPath)) {
        console.log('Video file created successfully');
        resolve(outputPath);
      } else {
        console.error('Video file was not created');
        reject(new Error('Video file was not created'));
      }
    });
  });
}

function uploadVideoToLivepeer(filePath) {
  return new Promise(async (resolve, reject) => {
    try {
      console.log('Requesting upload URL from Livepeer...');
      const requestUploadResponse = await axios.post(`${API_URL}/asset/request-upload`, 
        { name: "AI Generated Movie Scene" },
        {
          headers: {
            'Authorization': `Bearer ${API_KEY}`,
            'Content-Type': 'application/json'
          }
        }
      );

      console.log('Request upload response:', JSON.stringify(requestUploadResponse.data, null, 2));

      const tusEndpoint = requestUploadResponse.data.tusEndpoint;

      console.log('Starting Tus upload...');
      const file = fs.createReadStream(filePath);
      const size = fs.statSync(filePath).size;

      const upload = new tus.Upload(file, {
        endpoint: tusEndpoint,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        metadata: {
          filename: 'movie_scene.mp4',
          filetype: 'video/mp4'
        },
        uploadSize: size,
        onError: function(error) {
          console.error("Upload failed:", error);
          console.error("Error details:", JSON.stringify(error, null, 2));
          reject(error);
        },
        onProgress: function(bytesUploaded, bytesTotal) {
          const percentage = ((bytesUploaded / bytesTotal) * 100).toFixed(2);
          console.log(`Uploaded ${bytesUploaded} of ${bytesTotal} bytes (${percentage}%)`);
        },
        onSuccess: function() {
          console.log("Upload finished:", upload.url);
          const assetId = requestUploadResponse.data.asset.id;
          const playbackId = requestUploadResponse.data.asset.playbackId;
          const playbackUrl = `https://lvpr.tv/?v=${playbackId}`;
          console.log('Playback URL:', playbackUrl);
          resolve(playbackUrl);
        }
      });

      upload.start();

    } catch (error) {
      console.error('Error in upload process:', error);
      if (error.response) {
        console.error('Response status:', error.response.status);
        console.error('Response data:', JSON.stringify(error.response.data, null, 2));
        console.error('Response headers:', JSON.stringify(error.response.headers, null, 2));
      }
      reject(error);
    }
  });
}

function adjustVideoDuration(inputPath, outputPath, targetDuration) {
  return new Promise((resolve, reject) => {
    const command = `ffmpeg -i ${inputPath} -filter:v "setpts=(${targetDuration}/3.57)*PTS" -filter:a "atempo=(3.57/${targetDuration})" ${outputPath}`;
    
    console.log('Executing ffmpeg command:', command);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing ffmpeg:', error);
        return reject(error);
      }
      if (stderr) {
        console.error('ffmpeg stderr:', stderr);
      }
      console.log('ffmpeg stdout:', stdout);
      
      if (fs.existsSync(outputPath)) {
        console.log('Video duration adjusted successfully');
        resolve(outputPath);
      } else {
        console.error('Adjusted video file was not created');
        reject(new Error('Adjusted video file was not created'));
      }
    });
  });
}

async function generateMovieScene(sceneData) {
  const videoPaths = [];
  const audioPaths = [];
  
  for (let i = 0; i < sceneData.length; i++) {
    console.log(`Processing scene ${i + 1}/${sceneData.length}...`);
    
    // Generate image and video
    const aiImageResult = await generateAIImage(sceneData[i].prompt);
    const aiImageUrl = aiImageResult.images[0].url;
    const aiImagePath = `ai_generated_image_${i}.png`;
    await downloadAIImage(aiImageUrl, aiImagePath);
    console.log(`Image ${i + 1} downloaded successfully`);

    const videoPath = await generateVideoFromImage(aiImagePath, sceneData[i].duration);
    videoPaths.push(videoPath);
    console.log(`Video ${i + 1} generated successfully`);

    // Generate audio (dialogue and sound effect)
    const audioPath = await generateSceneAudio(sceneData[i]);
    audioPaths.push(audioPath);
    console.log(`Audio ${i + 1} generated successfully`);

    // Clean up the image file
    try {
      await fs.promises.unlink(aiImagePath);
    } catch (error) {
      console.error(`Error deleting image file ${aiImagePath}:`, error);
    }
  }

  console.log('Creating final video from generated videos and audios...');
  const finalVideoPath = 'movie_scene.mp4';
  await createVideoWithAudio(videoPaths, audioPaths, finalVideoPath);

  console.log('Uploading video to Livepeer...');
  const playbackUrl = await uploadVideoToLivepeer(finalVideoPath);

  console.log('Movie scene generated and uploaded successfully!');
  console.log('You can view your video at:', playbackUrl);

  // Clean up temporary files
  try {
    for (const path of [...videoPaths, ...audioPaths]) {
      await fs.promises.unlink(path);
    }
    await fs.promises.unlink(finalVideoPath);
    console.log('Temporary files deleted');
  } catch (error) {
    console.error('Error deleting temporary files:', error);
    // Continue execution even if deletion fails
  }

  return playbackUrl;
}

async function generateSceneAudio(sceneData) {
  const dialogueAudioPath = sceneData.dialogue ? await generateDialogue(sceneData.dialogue) : null;
  const soundEffectAudioPath = await generateSoundEffect(sceneData.soundEffect);
  
  // Combine dialogue and sound effect
  const combinedAudioPath = `combined_audio_${Date.now()}.mp3`;
  await combineAudioFiles(dialogueAudioPath, soundEffectAudioPath, combinedAudioPath);
  
  // Clean up individual audio files
  try {
    if (dialogueAudioPath) await fs.promises.unlink(dialogueAudioPath);
    await fs.promises.unlink(soundEffectAudioPath);
  } catch (error) {
    console.error('Error deleting temporary audio files:', error);
    // Continue execution even if deletion fails
  }

  return combinedAudioPath;
}

const TEST_VOICE_ID = "pMsXgVXv3BLzUgSXRplE";
// Actor to Voice ID mapping
const actorVoiceMap = {
  "Tom Hanks": "tkOyqGbCSr2yWYLucS6Y",
  "Leonardo DiCaprio": "bIHbv24MWmeRgasZH58o",
  "Brad Pitt": "cjVigY5qzO86Huf0OWal",
  "Samuel L. Jackson": "nPczCjzI2devNBz1zQrb",
  "Meryl Streep": "Xb7hH8MSUJpSbSDYk0k2",
  "Scarlett Johansson": "PG7cZldM4iWlbugny2fe",
  "Gal Gadot": "FGY2WhTYpPnrIDTdsKH5",
  "Tina Fey": "XrExE9yKIg1WjnnlVkGX"
};
// Function to get voice ID for an actor
function getVoiceIdForActor(actor) {
  return actorVoiceMap[actor] || TEST_VOICE_ID; // Use TEST_VOICE_ID as fallback
}
async function generateDialogue(dialogueData) {
  const voiceId = getVoiceIdForActor(dialogueData.actor); // Implement this function to map actors to voice IDs
  try {
    const audioBuffer = await client.textToSpeech.convert(voiceId, {
      text: dialogueData.text,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.5
      },
      output_format: ElevenLabs.OutputFormat.Mp3441001281 
    });

    const audioPath = `dialogue_${Date.now()}.mp3`;
    await fs.promises.writeFile(audioPath, audioBuffer);
    console.log(`Dialogue audio saved to ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error('Error generating dialogue:', error);
    throw error;
  }
}

async function generateSoundEffect(soundEffectDescription) {
  try {
    const audioBuffer = await client.textToSoundEffects.convert({
      text: soundEffectDescription,
      duration_seconds: 5, // Adjust as needed
      prompt_influence: 0.5
    });
    
    const audioPath = `sound_effect_${Date.now()}.mp3`;
    await fs.promises.writeFile(audioPath, audioBuffer);
    console.log(`Sound effect audio saved to ${audioPath}`);
    return audioPath;
  } catch (error) {
    console.error('Error generating sound effect:', error);
    throw error;
  }
}

async function combineAudioFiles(dialoguePath, soundEffectPath, outputPath) {
  // Use ffmpeg to combine audio files
  const command = `ffmpeg -i ${dialoguePath || 'anullsrc'} -i ${soundEffectPath} -filter_complex "[0:a][1:a]amix=inputs=2:duration=longest" ${outputPath}`;
  
  return new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error combining audio files:', error);
        reject(error);
      } else {
        console.log('Audio files combined successfully');
        resolve();
      }
    });
  });
}

async function createVideoWithAudio(videoPaths, audioPaths, outputPath) {
  if (videoPaths.length !== audioPaths.length) {
    throw new Error('Number of video paths must match number of audio paths');
  }

  // Create temporary files for intermediate processing
  const tempFiles = [];
  const inputFiles = [];

  for (let i = 0; i < videoPaths.length; i++) {
    const tempVideoWithAudio = `temp_video_audio_${i}.mp4`;
    tempFiles.push(tempVideoWithAudio);

    // Combine each video with its corresponding audio
    await new Promise((resolve, reject) => {
      const command = `ffmpeg -i ${videoPaths[i]} -i ${audioPaths[i]} -c:v copy -c:a aac -strict experimental ${tempVideoWithAudio}`;
      exec(command, (error, stdout, stderr) => {
        if (error) {
          console.error(`Error processing video ${i}:`, error);
          reject(error);
        } else {
          console.log(`Processed video ${i} successfully`);
          resolve();
        }
      });
    });

    inputFiles.push(`-i ${tempVideoWithAudio}`);
  }

  // Concatenate all temporary video files
  const inputFilesString = inputFiles.join(' ');
  const filterComplex = `concat=n=${videoPaths.length}:v=1:a=1[outv][outa]`;
  
  const finalCommand = `ffmpeg ${inputFilesString} -filter_complex "${filterComplex}" -map "[outv]" -map "[outa]" ${outputPath}`;

  return new Promise((resolve, reject) => {
    exec(finalCommand, (error, stdout, stderr) => {
      if (error) {
        console.error('Error creating final video with audio:', error);
        reject(error);
      } else {
        console.log('Final video with audio created successfully');
        resolve();
      }
    }).on('close', async () => {
      // Clean up temporary files
      for (const tempFile of tempFiles) {
        try {
          await fs.promises.unlink(tempFile);
          console.log(`Deleted temporary file: ${tempFile}`);
        } catch (unlinkError) {
          console.error(`Error deleting temporary file ${tempFile}:`, unlinkError);
        }
      }
    });
  });
}

function createVideoFromVideos(videoPaths, outputPath, durations) {
  return new Promise((resolve, reject) => {
    const inputFiles = videoPaths.map(path => `-i ${path}`).join(' ');
    const filterComplex = videoPaths.map((_, index) => `[${index}:v]setpts=PTS-STARTPTS[v${index}];`).join('');
    const filterComplexConcat = videoPaths.map((_, index) => `[v${index}]`).join('') + `concat=n=${videoPaths.length}:v=1:a=0[outv]`;
    
    const command = `ffmpeg -y ${inputFiles} -filter_complex "${filterComplex}${filterComplexConcat}" -map "[outv]" -c:v libx264 -pix_fmt yuv420p ${outputPath}`;
    
    console.log('Executing ffmpeg command:', command);
    
    exec(command, (error, stdout, stderr) => {
      if (error) {
        console.error('Error executing ffmpeg:', error);
        return reject(error);
      }
      if (stderr) {
        console.error('ffmpeg stderr:', stderr);
      }
      console.log('ffmpeg stdout:', stdout);
      
      if (fs.existsSync(outputPath)) {
        console.log('Video file created successfully');
        resolve(outputPath);
      } else {
        console.error('Video file was not created');
        reject(new Error('Video file was not created'));
      }
    });
  });
}

async function generateVideoFromImage(imagePath, duration, retryCount = 0) {
  const form = new FormData();
  form.append('image', fs.createReadStream(imagePath));
  form.append('model_id', 'stabilityai/stable-video-diffusion-img2vid-xt-1-1');
  
  try {
    const response = await axios.post('https://dream-gateway.livepeer.cloud/image-to-video', form, {
      headers: {
        ...form.getHeaders(),
        'Authorization': `Bearer ${API_KEY}`
      }
    });

    if (response.data && response.data.images && response.data.images[0] && response.data.images[0].url) {
      const videoUrl = response.data.images[0].url;
      console.log(`Video generated successfully: ${videoUrl}`);
      
      // Download the video
      const tempVideoPath = `temp_video_${Date.now()}.mp4`;
      await downloadAIImage(videoUrl, tempVideoPath);
      
      // Adjust the video to the desired duration
      const adjustedVideoPath = `adjusted_video_${Date.now()}.mp4`;
      await adjustVideoDuration(tempVideoPath, adjustedVideoPath, duration);
      
      // Clean up the temporary file
      fs.unlinkSync(tempVideoPath);
      
      return adjustedVideoPath;
    } else {
      throw new Error('Invalid response from image-to-video API');
    }
  } catch (error) {
    console.error(`Error generating video from image (attempt ${retryCount + 1}):`, error.message);
    
    if (retryCount < MAX_RETRIES) {
      console.log(`Retrying in ${RETRY_DELAY / 1000} seconds...`);
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAY));
      return generateVideoFromImage(imagePath, duration, retryCount + 1);
    }
    
    throw error;
  }
}

async function getFormattedSceneData(userInput, actors) {
  const basePrompt = `Create a movie scene based on the following user input: ${userInput}. Include the following actors: ${actors}`;
  const formattingInstructions = `
    Format your response as a JSON array of scene objects. Each scene object should have the following properties:
    - startTime: number (in seconds)
    - duration: number (in seconds, keep this number between 3-5)
    - prompt: string (description of the scene including the actor name if you want to show a person) Make sure in each clip to include full and consistent descriptions because using generalities, definite article, and referencing context of other prompts is useless. You are generating an image with your prompt, so focus on what you want the image and shot to be for each prompt, clear and detailed.
    - soundEffect: string (description of the sound effect for the scene)
    - dialogue: object with properties:
      - actor: string (name of the actor speaking)
      - text: string (the dialogue text)
    
    Example:
    [
      {
        "startTime": 0,
        "duration": 5,
        "prompt": "A black starship emerging from hyperspace",
        "soundEffect": "Loud whoosh of a spaceship exiting hyperspace",
        "dialogue": {
          "actor": "Tom Cruise",
          "text": "Prepare for arrival!"
        }
      },
      {
        "startTime": 5,
        "duration": 7,
        "prompt": "A caped superhero Henry Cavill flying toward a black starship that has emerged from hyperspace",
        "soundEffect": "Whooshing air as the superhero flies",
        "dialogue": {
          "actor": "Henry Cavill",
          "text": "I'm coming to save you!"
        }
      }
    ]
  `;

  const fullPrompt = `${basePrompt}\n\n${formattingInstructions}`;

  try {
    console.log("Starting chat with Galadriel contract...");
    const startChatTx = await galadrielContract.startChat(fullPrompt);

    const receipt = await startChatTx.wait();

    const chatCreatedEvent = receipt.events.find(event => event.event === "ChatCreated");
    if (!chatCreatedEvent) {
      throw new Error("ChatCreated event not found in transaction receipt");
    }
    const chatId = chatCreatedEvent.args.chatId;
    console.log("Chat ID:", chatId);

    console.log("Waiting for chat response...");
    const response = await waitForChatResponse(chatId);
    
    console.log('Raw response:', response);
    
    // Extract JSON from the response
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("No valid JSON found in the response");
    }
    
    const jsonString = jsonMatch[0];
    
    let sceneData;
    try {
      sceneData = JSON.parse(jsonString);
    } catch (parseError) {
      console.error("Error parsing JSON response:", parseError);
      console.log("Extracted JSON string:", jsonString);
      throw new Error("Invalid JSON structure in the extracted response");
    }
    
    // Validate the scene data
    const validatedSceneData = sceneData.map(scene => ({
      startTime: typeof scene.startTime === 'number' ? scene.startTime : 0,
      duration: typeof scene.duration === 'number' && scene.duration > 0 ? scene.duration : 5,
      prompt: typeof scene.prompt === 'string' ? scene.prompt : "Default scene description",
      soundEffect: typeof scene.soundEffect === 'string' ? scene.soundEffect : "Default sound effect",
      dialogue: {
        actor: scene.dialogue && typeof scene.dialogue.actor === 'string' ? scene.dialogue.actor : "Unknown Actor",
        text: scene.dialogue && typeof scene.dialogue.text === 'string' ? scene.dialogue.text : ""
      }
    }));

    return validatedSceneData;
  } catch (error) {
    console.error("Error getting formatted scene data:", error);
    throw error;
  }
}




// Helper function to wait for chat response
function waitForChatResponse(chatId) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      galadrielContract.removeAllListeners("ChatResponse");
      reject(new Error("Timeout waiting for chat response"));
    }, 60000); // 1 minute timeout

    galadrielContract.on("ChatResponse", async (responseChatId, event) => {
      if (responseChatId.eq(chatId)) {
        clearTimeout(timeout);
        galadrielContract.removeAllListeners("ChatResponse");

        try {
          // Fetch the chat history to get the response
          const messageHistory = await galadrielContract.getMessageHistory(chatId);
          
          // The last message should be the assistant's response
          const lastMessage = messageHistory[messageHistory.length - 1];
          
          if (lastMessage && lastMessage.role === "assistant") {
            resolve(lastMessage.content[0].value);
          } else {
            reject(new Error("Unable to find assistant's response in chat history"));
          }
        } catch (error) {
          reject(new Error(`Error fetching chat history: ${error.message}`));
        }
      }
    });
  });
}

async function handleCreateMovie(movieId, creator, actors, prompt) {
  console.log(`New movie created: ID ${movieId}, Creator: ${creator}, Actors: ${actors}, Prompt: ${prompt}`);

  try {
    const sceneData = await getFormattedSceneData(prompt, actors);
    const playbackUrl = await generateMovieScene(sceneData);

    console.log(`Movie scene generated successfully for movie ID ${movieId}`);
    console.log('Playback URL:', playbackUrl);

    // Update the movie link on the Story Protocol contract
    await updateMovieLink(movieId, playbackUrl);

    console.log(`Movie link updated for movie ID ${movieId}`);
  } catch (error) {
    console.error(`Error processing movie ID ${movieId}:`, error);
  }
}

async function updateMovieLink(movieId, link) {
  try {
    const tx = await storyContract.updateMovieLink(movieId, link);
    await tx.wait();
    console.log(`Movie link updated for movie ID ${movieId}`);
  } catch (error) {
    console.error(`Error updating movie link for movie ID ${movieId}:`, error);
    throw error;
  }
}

function listenForCreateMovieEvents() {
  console.log('Listening for MovieCreated events...');
  storyContract.on("MovieCreated", async (movieId, creator, actors, prompt, event) => {
    console.log(`MovieCreated event detected: Movie ID ${movieId}`);
    await handleCreateMovie(movieId, creator, actors, prompt);
  });
}

async function main() {
  try {
    console.log('Starting the movie generation service...');
    listenForCreateMovieEvents();
    console.log('Listening for MovieCreated events. Press Ctrl+C to exit.');

    // Keep the script running
    process.stdin.resume();
  } catch (error) {
    console.error('Error in main function:', error);
  }
}

// Comment out or remove the runDemo() call
// runDemo();

// Run the main function
main();
