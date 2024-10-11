# 🎬 StarForge: AI-Powered Movie Scene Generator

StarForge is an innovative hackathon project that combines blockchain technology, AI services, and multimedia generation to create a platform for generating licensed actor likeness generative films.

## 🌟 Project Overview

StarForge allows users to select actors, input movie prompts, and automatically generate AI-powered movie scenes. The project leverages smart contracts for licensing management and integrates various AI services for content generation.

### 🧩 Key Components

1. **Smart Contract (`starforge.sol`)**
   - Handles actor licensing and movie creation
   - Integrates with Story Protocol for IP asset registration

2. **Backend Service (`moviegen.js`)**
   - Listens to the StarForge contract for new movie creation events
   - Generates movie scripts using AI
   - Creates visuals, dialogue, and sound effects using various AI services - Galadriel, Elevenlabs, and Livepeer AI pipelines
   - Combines generated media into a final video
   - Uploads the video to Livepeer for streaming

3. **Web Interface (`index.html`, `gallery.html`, `style.css`, `constants.js`)**
   - Provides a user-friendly interface for actor selection, movie prompt input, and viewership
   - Interacts with the smart contract to initiate movie creation

## ✨ Features

- 📝 AI-powered script generation
- 🖼️ Image and video generation based on prompts
- 🗣️ Text-to-speech conversion for character dialogue
- 🎵 AI-generated sound effects
- 🎥 Automatic video compilation and upload to Livepeer
- 📜 Blockchain-based licensing management

## 🛠️ Technologies Used

- Solidity (Smart Contracts)
- Ethers.js (Blockchain Interaction)
- Node.js (Backend Service)
- HTML/CSS/JavaScript (Frontend)
- AI APIs
   - Livepeer AI Pipelines (Image Generation, Image to Video)
   - Galadriel (Script and prompt generation)
   - Elevenlabs (Voice Cloning, Text to Sound Effect, Text to Speech)
- Livepeer (Video Streaming)
- FFmpeg (Video Processing)

## 🎭 Demo

You can try out the StarForge demo at [https://webed.academy/starforge/index.html](https://webed.academy/starforge/index.html)

Demo video:

https://youtu.be/OaPE96wkyCE?si=KvuP8OPtK1KDJbUI

For more information about the project, check out the [Remsee YouTube channel](https://www.youtube.com/@remsee1608).

## 🚀 Setup

To run the project locally:

1. Clone the repository
2. Navigate to the project directory
3. Install dependencies:
   ```bash
   npm install axios fs child_process tus-js-client form-data ethers dotenv elevenlabs
## 📖 Usage

1. Visit the demo link or your local setup
2. Select actors from the provided options
3. Enter a movie prompt in the text field
4. Click "Generate Movie" to create your AI-generated movie scene

## 📄 License

This project is open-source and free to use. Anyone can use, modify, and distribute this software.

## 🙏 Acknowledgements

- [Story Protocol](https://github.com/storyprotocol)
- [Galadriel AI](https://github.com/galadriel-ai/contracts)
- [Livepeer](https://docs.livepeer.org/developers/introduction)
- [ElevenLabs](https://elevenlabs.io/docs/introduction)

---

Made with ❤️ by Remsee
