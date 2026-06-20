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

const NEWS_GENERATOR_SYSTEM_INSTRUCTION = `
You are a creative copywriter and tech blogger. Your task is to write a short, engaging, and completely natural post in Russian for Threads based on the provided news item.
Follow these rules strictly:

1. PERSONALITY AND VOICE:
- Write in the first-person perspective ("я", "мне кажется", "заметил", "думаю", "честно говоря").
- Tone should be informal, relaxed, and authentic, like a real person sharing a note.
- Vary the sentence length. Use short punchy sentences mixed with longer ones.

2. STRICT ANTI-AI PATTERNS (AVOID THESE IN RUSSIAN):
- Never use AI vocabulary and clichés: "важно отметить", "в современном мире", "стремительно развивающийся", "ландшафт", "уникальный", "ключевой", "стоит подчеркнуть", "настоящий прорыв", "углубиться", "гармония", "ценность".
- Avoid copula avoidance: use simple "это", "есть" instead of "служит в качестве", "выступает в роли", "представляет собой".
- Avoid negative parallelisms like "это не просто X, это Y".
- Do NOT use emojis at the start of every sentence/bullet. Emojis must be used naturally and sparingly (maximum 1-2 per post).
- Do NOT use markdown bold headers, lists, bullet points, or asterisks. Write in plain text without markdown symbols.

3. FORMAT:
- Output only the final post text. No introductory remarks (do NOT write "Вот ваш пост:", "Перевод:", "Новость:").
- Keep it under 400 characters.
- Do NOT place a period/dot (.) at the very end of the post. End with a word, question mark, exclamation mark, emoji, or ellipsis, but never a single period.
`;

async function callGemini(apiKey, systemInstruction, promptText, model = 'gemini-3.5-flash', enableSearch = false) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  
  const body = {
    system_instruction: {
      parts: [
        {
          text: systemInstruction
        }
      ]
    },
    contents: [
      {
        parts: [
          {
            text: promptText
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1500
    }
  };

  if (enableSearch) {
    body.tools = [{ google_search: {} }];
  }

  const maxRetries = 3;
  let delay = 2000;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      console.log('Gemini API raw response:', JSON.stringify(data, null, 2));
      if (!res.ok || data.error) {
        const status = data.error?.status || res.status;
        const isTransient = status === 503 || status === 'UNAVAILABLE' || res.status === 503;
        if (isTransient && attempt < maxRetries) {
          console.warn(`Gemini API 503 (Unavailable) on attempt ${attempt}. Retrying in ${delay}ms...`);
          await sleep(delay);
          delay *= 2;
          continue;
        }
        throw new Error(`Gemini API error: ${JSON.stringify(data.error || data)}`);
      }

      return data.candidates[0].content.parts.map(p => p.text).join('').trim();
    } catch (err) {
      if (attempt === maxRetries) {
        throw err;
      }
      console.warn(`Gemini API call failed on attempt ${attempt}: ${err.message}. Retrying in ${delay}ms...`);
      await sleep(delay);
      delay *= 2;
    }
  }
}

async function fetchLatestTechNews() {
  try {
    console.log('Fetching latest news from TechCrunch RSS feed...');
    const res = await fetch('https://techcrunch.com/feed/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    const xml = await res.text();
    
    const items = [];
    const itemMatches = xml.matchAll(/<item>([\s\S]*?)<\/item>/g);
    for (const match of itemMatches) {
      const itemContent = match[1];
      
      // Parse Title
      let title = '';
      const titleCdataMatch = itemContent.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i);
      if (titleCdataMatch) {
        title = titleCdataMatch[1];
      } else {
        const titleNormalMatch = itemContent.match(/<title>([\s\S]*?)<\/title>/i);
        if (titleNormalMatch) title = titleNormalMatch[1];
      }
      
      // Parse Description
      let description = '';
      const descCdataMatch = itemContent.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/i);
      if (descCdataMatch) {
        description = descCdataMatch[1];
      } else {
        const descNormalMatch = itemContent.match(/<description>([\s\S]*?)<\/description>/i);
        if (descNormalMatch) description = descNormalMatch[1];
      }
      
      description = description.replace(/<\/?[^>]+(>|$)/g, "").substring(0, 150);
      
      if (title) {
        items.push({ title: title.trim(), description: description.trim() });
      }
    }
    
    return items;
  } catch (err) {
    console.warn('Failed to fetch TechCrunch RSS, falling back to offline generation:', err.message);
    return [];
  }
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
          try {
            finalPostText = await callGemini(geminiApiKey, HUMANIZER_SYSTEM_INSTRUCTION, "Пожалуйста, перепиши и хуманизируй следующий текст:\n\n" + rawDraft, 'gemini-3.5-flash');
          } catch (err) {
            console.warn('Gemini 3.5 Flash failed. Trying Gemini 2.5 Flash:', err.message);
            finalPostText = await callGemini(geminiApiKey, HUMANIZER_SYSTEM_INSTRUCTION, "Пожалуйста, перепиши и хуманизируй следующий текст:\n\n" + rawDraft, 'gemini-2.5-flash');
          }
        } else {
          console.log('\nthoughts.txt is empty or missing. Fetching fresh news from TechCrunch...');
          const newsItems = await fetchLatestTechNews();
          
          let prompt = '';
          if (newsItems.length > 0) {
            // Select the first item
            const latestNews = newsItems[0];
            console.log(`Successfully fetched news: "${latestNews.title}"`);
            prompt = `
Вот свежая новость из сферы технологий:
Название: "${latestNews.title}"
Описание: "${latestNews.description}"

Напиши короткий неформальный пост на русском языке на основе этой новости для моего блога в Threads. Поделись этой новостью и добавь короткую мысль или реакцию от себя (например, почему это важно).
`;
          } else {
            console.log('No news articles fetched. Generating a general IT/SMM trend observation...');
            prompt = `
Сгенерируй короткую интересную мысль, наблюдение или тренд из сферы IT, SMM или искусственного интеллекта.
`;
          }
          
          try {
            finalPostText = await callGemini(geminiApiKey, NEWS_GENERATOR_SYSTEM_INSTRUCTION, prompt, 'gemini-3.5-flash', false);
          } catch (err) {
            console.warn('Gemini 3.5 Flash failed. Trying Gemini 2.5 Flash:', err.message);
            finalPostText = await callGemini(geminiApiKey, NEWS_GENERATOR_SYSTEM_INSTRUCTION, prompt, 'gemini-2.5-flash', false);
          }
        }
    } catch (err) {
      console.error('All Gemini API models failed:', err.message);
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
