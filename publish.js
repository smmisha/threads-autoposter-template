const fs = require('fs');
const path = require('path');

// Helper to load environment variables from local .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      if (!line || line.startsWith('#')) return;
      const parts = line.split('=');
      if (parts.length >= 2) {
        const key = parts[0].trim();
        const value = parts.slice(1).join('=').trim();
        process.env[key] = value;
      }
    });
  }
}

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Prompt configuration based on the custom "humanizer" skill
const HUMANIZER_SYSTEM_INSTRUCTION = `
You are a expert editor and copywriter. Your task is to rewrite the input raw text to make it sound completely human-written, natural, and engaging for Russian-speaking Threads users.
Follow these rules strictly:

1. PERSONALITY AND VOICE:
- Write in the first-person perspective ("я", "мне кажется", "заметил", "думаю", "честно говоря").
- Make it sound like a real person sharing a casual note. It should be informal, relaxed, and authentic.
- Vary the sentence length. Use short punchy sentences mixed with longer ones.
- Acknowledge uncertainty or personal feelings (e.g., "я пока не знаю, взлетит ли это, но...", "звучит просто, но на деле...").

2. STRICT ANTI-AI PATTERNS (AVOID THESE IN RUSSIAN):
- Never use AI vocabulary and clichés: "важно отметить", "в современном мире", "стремительно развивающийся", "ландшафт", "экосистема", "уникальный", "ключевой", "является свидетельством", "стоит подчеркнуть", "настоящий прорыв", "углубиться", "гармония", "ценность".
- Avoid copula avoidance: use simple "это", "есть" instead of "служит в качестве", "выступает в роли", "представляет собой".
- Avoid negative parallelisms like "это не просто X, это Y" ("это не просто скрипт, это полноценный помощник" - remove this).
- Do NOT use emojis at the start of every sentence/bullet, nor bold headers or colons. Emojis must be used naturally and sparingly (maximum 1-2 per post).
- Avoid generic positive summaries or marketing slogans at the end ("впереди нас ждут великие дела", "давайте двигаться к успеху вместе").

3. FORMAT:
- The output must be pure text ready to copy-paste. No introductions like "Вот ваш текст:".
- Keep the post concise and make sure it fits within the 500-character limit.
- Do NOT place a period/dot (.) at the very end of the post. End with a word, question mark (?), exclamation mark (!), emoji, or ellipsis (...), but never a single period.
`;

const FALLBACK_PROMPT = `
Generate a short, useful digital/blogging tip, remote work insight, SMM advice, or a lighthearted observation about tech life/freelance in Russian for Threads.
Rotate between different topics (e.g., productivity, copywriting, personal branding, marketing, work-life balance, IT/office humor). Do NOT write only about automation.
It must follow all the anti-AI humanizer rules: first-person voice, no AI clichés, conversational tone, and fit under 400 characters.
`;

async function callGemini(apiKey, systemInstruction, promptText) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
  
  const body = {
    contents: [
      {
        parts: [
          {
            text: `${systemInstruction}\n\nInput text to rewrite/humanize:\n"${promptText}"`
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 300
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Gemini API error: ${JSON.stringify(data.error || data)}`);
  }

  return data.candidates[0].content.parts[0].text.trim();
}

async function publishNextPost() {
  loadEnv();

  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!accessToken || !userId) {
    console.error('ERROR: THREADS_ACCESS_TOKEN and THREADS_USER_ID must be set.');
    process.exit(1);
  }

  let rawDraft = '';
  let remainingThoughts = [];
  const thoughtsPath = path.join(__dirname, 'thoughts.txt');

  // 1. Read thoughts.txt if it exists
  if (fs.existsSync(thoughtsPath)) {
    try {
      const content = fs.readFileSync(thoughtsPath, 'utf8').trim();
      if (content) {
        // Split by "---" delimiter
        const thoughts = content.split(/\n---\n|\r\n---\r\n|---/);
        const activeThoughts = thoughts.map(t => t.trim()).filter(Boolean);
        
        if (activeThoughts.length > 0) {
          rawDraft = activeThoughts[0];
          remainingThoughts = activeThoughts.slice(1);
        }
      }
    } catch (err) {
      console.warn('Warning: Could not read thoughts.txt, falling back to AI generation:', err.message);
    }
  }

  let finalPostText = '';

  // 2. Process with Gemini API
  if (geminiApiKey) {
    try {
      if (rawDraft) {
        console.log(`\nFound raw draft in thoughts.txt: "${rawDraft.substring(0, 60)}..."`);
        console.log('Humanizing draft using Gemini API...');
        finalPostText = await callGemini(geminiApiKey, HUMANIZER_SYSTEM_INSTRUCTION, rawDraft);
      } else {
        console.log('\nthoughts.txt is empty or missing. Falling back to AI post generation...');
        finalPostText = await callGemini(geminiApiKey, HUMANIZER_SYSTEM_INSTRUCTION, FALLBACK_PROMPT);
      }
    } catch (err) {
      console.error('ERROR calling Gemini API:', err.message);
      // If we have a raw draft, we can fall back to using it directly without humanization
      if (rawDraft) {
        console.log('Falling back to raw draft text directly...');
        finalPostText = rawDraft;
      } else {
        process.exit(1);
      }
    }
  } else {
    // No Gemini key
    if (rawDraft) {
      console.log('\nWarning: GEMINI_API_KEY is not set. Publishing raw draft without humanization.');
      finalPostText = rawDraft;
    } else {
      console.error('ERROR: GEMINI_API_KEY is not set and thoughts.txt is empty. Nothing to publish.');
      process.exit(1);
    }
  }

  // Remove trailing period if present (unless it is part of an ellipsis)
  finalPostText = finalPostText.trim();
  if (finalPostText.endsWith('.') && !finalPostText.endsWith('...')) {
    console.log('Stripping trailing period from the end of the post.');
    finalPostText = finalPostText.slice(0, -1).trim();
  }

  // Double check post length
  if (finalPostText.length > 500) {
    console.log('Post too long, truncating to 500 characters...');
    finalPostText = finalPostText.substring(0, 497) + '...';
  }

  console.log(`\nFinal post text to publish:\n"${finalPostText}"`);

  // 3. Publish to Threads
  try {
    // Step 1: Create media container
    console.log('\nStep 1: Creating Threads media container...');
    const containerParams = new URLSearchParams({
      media_type: 'TEXT',
      text: finalPostText,
      access_token: accessToken
    });

    const containerRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: containerParams.toString()
    });

    const containerData = await containerRes.json();
    if (!containerRes.ok || containerData.error) {
      throw new Error(`Failed to create media container: ${JSON.stringify(containerData.error || containerData)}`);
    }

    const creationId = containerData.id;
    console.log(`Container created. ID: ${creationId}`);

    // Wait for the container to process
    console.log('Waiting 5 seconds for processing...');
    await sleep(5000);

    // Step 2: Publish media container
    console.log('Step 2: Publishing container...');
    const publishParams = new URLSearchParams({
      creation_id: creationId,
      access_token: accessToken
    });

    const publishRes = await fetch(`https://graph.threads.net/v1.0/${userId}/threads_publish`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: publishParams.toString()
    });

    const publishData = await publishRes.json();
    if (!publishRes.ok || publishData.error) {
      throw new Error(`Failed to publish container: ${JSON.stringify(publishData.error || publishData)}`);
    }

    console.log(`SUCCESS! Thread published successfully. Post ID: ${publishData.id}`);

    // 4. Update thoughts.txt (remove the processed draft)
    if (rawDraft) {
      try {
        const newContent = remainingThoughts.join('\n---\n');
        fs.writeFileSync(thoughtsPath, newContent, 'utf8');
        console.log('Removed published draft from thoughts.txt.');
      } catch (err) {
        console.error('Warning: Failed to update thoughts.txt:', err.message);
      }
    }

  } catch (error) {
    console.error('\nERROR during publication:', error.message);
    process.exit(1);
  }
}

publishNextPost();
