const axios = require('axios');
const fs = require('fs');
const { exec } = require('child_process');
const tus = require('tus-js-client');
const FormData = require('form-data');

const API_URL = 'https://livepeer.studio/api';
const AI_API_URL = 'https://dream-gateway.livepeer.cloud/text-to-image';
const API_KEY = '532d5b3e-f67b-48d7-bf2e-1f3a5c819ff3';

async function generateAIImage(prompt) {
  try {
    const options = {
      method: 'POST',
      url: AI_API_URL,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json'
      },
      data: {
        model_id: "SG161222/RealVisXL_V4.0_Lightning",
        prompt: prompt,
        width: 1280,
        height: 720
      }
    };

    const response = await axios(options);
    return response.data;
  } catch (error) {
    console.error('Error generating AI image:', error);
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
  
  for (let i = 0; i < sceneData.length; i++) {
    console.log(`Generating image ${i + 1}/${sceneData.length}...`);
    const aiImageResult = await generateAIImage(sceneData[i].prompt);
    const aiImageUrl = aiImageResult.images[0].url;
    const aiImagePath = `ai_generated_image_${i}.png`;
    await downloadAIImage(aiImageUrl, aiImagePath);
    console.log(`Image ${i + 1} downloaded successfully`);

    console.log(`Generating video from image ${i + 1}...`);
    const videoPath = await generateVideoFromImage(aiImagePath, sceneData[i].duration);
    videoPaths.push(videoPath);
    console.log(`Video ${i + 1} generated and adjusted successfully`);

    // Clean up the image file
    fs.unlinkSync(aiImagePath);
  }

  console.log('Creating final video from generated videos...');
  const finalVideoPath = 'movie_scene.mp4';
  await createVideoFromVideos(videoPaths, finalVideoPath);

  console.log('Uploading video to Livepeer...');
  const playbackUrl = await uploadVideoToLivepeer(finalVideoPath);

  console.log('Movie scene generated and uploaded successfully!');
  console.log('You can view your video at:', playbackUrl);

  // Clean up temporary files
  videoPaths.forEach(path => fs.unlinkSync(path));
  fs.unlinkSync(finalVideoPath);
  console.log('Temporary files deleted');

  return playbackUrl;
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
const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

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


// TODO: generate scene data dynamically based on user input
async function runDemo() {
  try {
    const sceneData = [
      // Boba Fett emerging from the sand (0-21 seconds)
      { startTime: 0, duration: 5, prompt: "Extreme close-up of coarse, sun-baked Tatooine sand. A single, scratched, green-armored finger breaks through the surface, twitching with life." },
      { startTime: 5, duration: 5, prompt: "Boba Fett's iconic green helmet emerges from the sand, covered in scratches and dents. Sand cascades off its surface, revealing the T-shaped visor. A Sarlacc tentacle, dripping with viscous fluid, slides off the helmet." },
      { startTime: 10, duration: 5, prompt: "Full body shot of Boba Fett rising from a sand dune. His armor is heavily damaged, with pieces missing. The twin suns of Tatooine gleam off his battered jetpack. Sand pours from every joint in his armor." },
      { startTime: 15, duration: 6, prompt: "Boba Fett stands atop a dune, silhouetted against the twin suns of Tatooine. His cape, tattered and torn, billows in the hot desert wind. In the distance, the Sarlacc pit is visible, tentacles writhing in frustration." },

      // Imperial Destroyer scenes (21-45 seconds)
      { startTime: 21, duration: 6, prompt: "Massive Imperial Star Destroyer floating in space, its wedge shape dominating the frame. Thousands of lights flicker across its surface. A nearby nebula casts an eerie, purple glow on the ship's hull." },
      { startTime: 27, duration: 6, prompt: "Interior view of the Star Destroyer's bridge. Rows of computer terminals stretch into the distance. Imperial officers in grey uniforms work diligently. Large viewports show the star-filled space beyond." },
      { startTime: 33, duration: 6, prompt: "Cavernous hangar bay of the Star Destroyer. TIE fighters hang from the ceiling in neat rows. Stormtroopers march in formation across the polished floor. A Lambda-class shuttle lands, its wings folding upward." },
      { startTime: 39, duration: 6, prompt: "Long, sterile corridor of the Star Destroyer. The walls are a stark, Imperial grey. Red and blue lights blink on control panels. Two stormtroopers patrol, their white armor a sharp contrast to the dark surroundings." },

      // Hooded figure revealed as Luke Skywalker (45-61 seconds)
      { startTime: 45, duration: 5, prompt: "A solitary figure in a dark hood walks purposefully down a dimly lit Star Destroyer corridor. The figure's face is completely shadowed. Their hand, visible at their side, is gloved in black." },
      { startTime: 50, duration: 5, prompt: "The hooded figure stops before a large blast door. Slowly, two hands, one flesh and one cybernetic, reach up to grasp the edges of the hood. Tension builds as the hands begin to lower the hood." },
      { startTime: 55, duration: 6, prompt: "Luke Skywalker's face is fully revealed as the hood falls away. He looks older, with grey streaks in his hair and beard. His eyes, once bright blue, now hold a hint of yellow. A thin scar runs across his right cheek." },

      // Luke with red lightsaber (61-77 seconds)
      { startTime: 61, duration: 5, prompt: "Close-up of Luke Skywalker's hand igniting a lightsaber. The blade that emerges is a deep, menacing red. The crimson light reflects in Luke's eyes, making them appear to glow with an inner fire." },
      { startTime: 66, duration: 5, prompt: "Full body shot of Luke Skywalker in a fighting stance, wielding the red lightsaber. His black robes swirl around him. The corridor behind him is bathed in the red glow of the saber. His expression is fierce and determined." },
      { startTime: 71, duration: 6, prompt: "Extreme close-up of Luke Skywalker's eyes. One eye is still blue, the other has turned completely yellow. Conflict and turmoil are evident in his gaze. The red glow of the lightsaber reflects in his pupils." },

      // Padawan life revealed (77-100 seconds)
      { startTime: 77, duration: 7, prompt: "Wide shot of a large training room aboard the Star Destroyer. Young Padawans of various alien races practice with training sabers. The walls are lined with ancient Jedi artifacts. Floating training droids hover around the room." },
      { startTime: 84, duration: 8, prompt: "Luke Skywalker enters the training room, now wielding his father's blue lightsaber. The Padawans stop their practice, turning to face him with a mix of awe and fear. Luke's expression has softened, but wariness remains in his eyes." },
      { startTime: 92, duration: 8, prompt: "Luke demonstrates an advanced lightsaber technique to the Padawans. His movements are fluid and graceful. The blue blade leaves trails of light in the air. The Padawans watch intently, some trying to mimic his movements." },

      // Millennium Falcon arrives (100-129 seconds)
      { startTime: 100, duration: 7, prompt: "The Millennium Falcon approaches the Star Destroyer, its distinctive shape unmistakable against the backdrop of stars. The ship shows signs of recent battle, with scorch marks on its hull. It flies erratically, as if the pilot is in a hurry." },
      { startTime: 107, duration: 7, prompt: "Inside the Star Destroyer's hangar, Luke Skywalker stands waiting. His face is a mix of anticipation and worry. Behind him, a squad of stormtroopers stands at attention. The Millennium Falcon slowly enters the hangar, its landing gear extending." },
      { startTime: 114, duration: 7, prompt: "The Falcon's ramp lowers with a hiss of hydraulics. Han Solo emerges, looking older and battle-worn. His trademark smirk is gone, replaced by a grim expression. He carries his blaster at the ready, eyes darting around the hangar suspiciously." },
      { startTime: 121, duration: 8, prompt: "Luke and Han embrace in the center of the hangar. The contrast between Luke's black robes and Han's familiar vest is stark. Both men's faces show relief at seeing each other, but also deep concern. In the background, stormtroopers shift uneasily." },

      // Han's news and flashback (129-175 seconds)
      { startTime: 129, duration: 8, prompt: "Close-up of Han Solo's left hand as he gestures while talking. His ring finger is conspicuously bare, with a pale band of skin where a wedding ring once sat. Luke's eyes focus on Han's hand, his expression changing to one of shock." },
      { startTime: 137, duration: 8, prompt: "Flashback: The lush forests of Kashyyyk. Thanos, a massive figure with purple skin, stands in a clearing. He raises the Infinity Gauntlet, golden metal gleaming. Wookiees flee in terror as trees disintegrate around them." },
      { startTime: 145, duration: 8, prompt: "Flashback: Chewbacca charges at Thanos, bowcaster raised and firing. His fur is singed and matted with blood. Chewbacca's eyes blaze with fury as he roars, showing his sharp teeth. Thanos turns slowly, almost lazily, to face the enraged Wookiee." },
      { startTime: 153, duration: 8, prompt: "Flashback: Thanos effortlessly catches Chewbacca by the throat. The Infinity Gauntlet glows with power. Chewbacca struggles, his massive arms straining against Thanos's grip. Thanos's face shows no emotion, just cold determination." },
      { startTime: 161, duration: 7, prompt: "Flashback: A silhouette of Thanos holding Chewbacca aloft. A sickening tearing sound is implied. Chewbacca's bowcaster falls to the ground. In the foreground, a group of horrified Wookiees howl in anguish, some turning to flee." },
      { startTime: 168, duration: 7, prompt: "Back to present: Extreme close-up of Luke Skywalker's face. His eyes widen in horror and disbelief. A single tear rolls down his cheek. His jaw clenches, and the yellow in his eyes flares brightly for a moment before fading back." },

      // Avengers Tower (175-176 seconds)
      { startTime: 175, duration: 1, prompt: "Quick shot of Avengers Tower in the New York City skyline. The distinctive 'A' logo glows brightly. The sky behind the tower is filled with strange, swirling energy patterns, hinting at cosmic disturbances." },

      // Tony Stark (176-177 seconds)
      { startTime: 176, duration: 1, prompt: "Tony Stark in his high-tech lab, surrounded by holographic displays. He manipulates a 3D projection of a time ribbon, his face illuminated by the blue glow. His expression is one of intense concentration and concern." },

      // Avengers assembling (177-238 seconds)
      { startTime: 177, duration: 3, prompt: "Close-up of Spider-Man's mask, eyes widening suddenly. The reflection of an incoming call with the Avengers logo is visible in the eye lenses." },
      { startTime: 180, duration: 4, prompt: "Spider-Man swings between skyscrapers, his red and blue suit gleaming. He releases his web mid-swing, free-falling while tapping his wrist to answer the call." },
      
      { startTime: 184, duration: 3, prompt: "Bruce Banner in a crowded street, looking down at a beeping device in his hand. His eyes flash green as he looks up, startled." },
      { startTime: 187, duration: 4, prompt: "Banner's transformation into the Hulk: his body swells, clothes tear, skin turning green. Bystanders scatter in panic as Hulk roars, fully formed." },
      
      { startTime: 191, duration: 3, prompt: "Exterior shot of the Baxter Building. A large '4' logo lights up suddenly, pulsing with energy." },
      { startTime: 194, duration: 4, prompt: "Inside the Baxter Building: Reed Richards stretches his arms to reach multiple computers. Alarms blare and emergency lights flash." },
      { startTime: 198, duration: 3, prompt: "Sue Storm turns invisible, her outline shimmering before disappearing completely. Next to her, Johnny Storm 'flames on', his body engulfed in fire." },
      { startTime: 201, duration: 3, prompt: "The Thing cracks his rocky knuckles, his face set in grim determination. Behind him, a large monitor shows a cosmic disturbance." },
      
      { startTime: 204, duration: 4, prompt: "Professor X in his hover chair, wearing Cerebro. The room around him pulses with psychic energy as his eyes glow brightly." },
      { startTime: 208, duration: 3, prompt: "Quick cut to Cyclops adjusting his visor, a beam of red energy flashing as he tests it." },
      { startTime: 211, duration: 3, prompt: "Jean Grey levitates off the ground, her hair flowing as if in water, eyes glowing with Phoenix fire." },
      { startTime: 214, duration: 3, prompt: "Wolverine unsheathes his claws with a 'SNIKT' sound, light glinting off the adamantium blades." },
      { startTime: 217, duration: 3, prompt: "Storm, her eyes white and crackling with electricity, summons wind that whips her cape dramatically." },
      
      { startTime: 220, duration: 4, prompt: "A massive, sleek spaceship with the Avengers logo stands ready on a launch pad. Its engines begin to glow, warming up." },
      { startTime: 224, duration: 3, prompt: "Iron Man streaks across the sky, leaving a trail of repulsor energy as he flies towards the ship." },
      { startTime: 227, duration: 3, prompt: "Captain America rides up on his motorcycle, shield on his back, expertly weaving through gathered vehicles." },
      { startTime: 230, duration: 4, prompt: "A quinjet lands near the spaceship. Black Widow and Hawkeye exit, weapons at the ready, scanning the area." },
      
      { startTime: 234, duration: 4, prompt: "Heroes ascend the spaceship's ramp. The Avengers lead, followed by the Fantastic Four and X-Men. Each costume gleams in the sunlight." },

      // Luke boards X-wing (247-260 seconds)
      { startTime: 247, duration: 6, prompt: "Luke Skywalker sprints across the Star Destroyer's hangar towards his X-wing fighter. His black robes billow behind him. Mechanics and droids scramble to clear a path. Luke's face shows urgency and determination." },
      { startTime: 253, duration: 7, prompt: "Luke climbs into the X-wing's cockpit. R2-D2 is lowered into its socket behind the cockpit, beeping excitedly. The cockpit canopy begins to close. Luke's hand moves over the controls, flipping switches to power up the ship." },

      // Time ribbon and wormhole (260-272 seconds)
      { startTime: 260, duration: 6, prompt: "The Avengers' ship approaches a shimmering, ribbon-like distortion in space. The ribbon pulses with every color imaginable. Stars around it appear to bend and warp. The ship's hull reflects the chaotic light of the anomaly." },
      { startTime: 266, duration: 6, prompt: "The Avengers' ship is pulled into the time ribbon. It stretches and distorts as it enters. Inside, the heroes brace themselves. The view outside the windows is a psychedelic tunnel of light and energy, stars streaking past at impossible speeds." },

      // Emerging near Imperial ship (272-278 seconds)
      { startTime: 272, duration: 6, prompt: "The Avengers' ship bursts out of the wormhole, energy crackling around its hull. In the background looms the massive form of the Imperial Star Destroyer. The contrast between the sleek Avengers ship and the angular Star Destroyer is stark." },

      // Luke's X-wing meeting Avengers (278-300 seconds)
      { startTime: 278, duration: 7, prompt: "Luke's X-wing fighter launches from the Star Destroyer's hangar, engines glowing bright blue. The fighter banks hard, orienting itself towards the Avengers' ship. Stars streak past as Luke pushes the throttle to maximum." },
      { startTime: 285, duration: 7, prompt: "The X-wing approaches the Avengers' ship. Luke's fighter looks tiny compared to the larger vessel. The cockpit of the X-wing is visible, showing Luke piloting with intense focus. R2-D2's dome swivels, scanning the Avengers' ship." },
      { startTime: 292, duration: 8, prompt: "Final shot: Luke's X-wing flies in formation with the Avengers' ship. Both vessels face an unknown threat off-screen. The Star Destroyer looms behind them. This unlikely alliance of Star Wars and Marvel heroes is ready for the battle ahead." }
    ];

    const playbackUrl = await generateMovieScene(sceneData);

    console.log('Demo completed successfully!');
    console.log('You can view your movie scene at:', playbackUrl);
  } catch (error) {
    console.error('Error in demo:', error);
  }
}

// Run the demo
runDemo();
