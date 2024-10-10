🎬 StarForge: AI-Powered Movie Scene Generator
StarForge is an innovative hackathon project that combines blockchain technology, AI services, and multimedia generation to create a platform for generating licensed actor likeness generative films.
🌟 Project Overview
StarForge allows users to select actors, input movie prompts, and automatically generate AI-powered movie scenes. The project leverages smart contracts for licensing management and integrates various AI services for content generation.
🧩 Key Components

Smart Contract (starforge.sol)

Handles actor licensing and movie creation
Integrates with Story Protocol for IP asset registration


Backend Service (moviegen.js)

Listens to the StarForge contract for new movie creation events
Generates movie scripts using AI
Creates visuals, dialogue, and sound effects using various AI services
Combines generated media into a final video
Uploads the video to Livepeer for streaming


Web Interface (index.html, style.css, constants.js)

Provides a user-friendly interface for actor selection and movie prompt input
Interacts with the smart contract to initiate movie creation



✨ Features

📝 AI-powered script generation
🖼️ Image and video generation based on prompts
🗣️ Text-to-speech conversion for character dialogue
🎵 AI-generated sound effects
🎥 Automatic video compilation and upload to Livepeer
📜 Blockchain-based licensing management

🛠️ Technologies Used

Solidity (Smart Contracts)
Ethers.js (Blockchain Interaction)
Node.js (Backend Service)
HTML/CSS/JavaScript (Frontend)
AI APIs (Image Generation, Text-to-Speech, etc.)
Livepeer (Video Streaming)
FFmpeg (Video Processing)

🎭 Demo
You can try out the StarForge demo at https://webed.academy/starforge/index.html
[Placeholder for Demo Video]
For more information about the project, check out the Remsee YouTube channel.
🚀 Setup
To run the project locally:

Clone the repository
Navigate to the project directory
Install dependencies:
bash
