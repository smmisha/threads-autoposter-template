const fs = require('fs');
const path = require('path');

// Helper to load environment variables from local .env file
function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    envContent.split('\n').forEach(line => {
      // Ignore comments and empty lines
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

// Helper to delay execution
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function publishNextPost() {
  loadEnv();

  const accessToken = process.env.THREADS_ACCESS_TOKEN;
  const userId = process.env.THREADS_USER_ID;

  if (!accessToken || !userId) {
    console.error('ERROR: THREADS_ACCESS_TOKEN and THREADS_USER_ID must be set in env variables or .env file.');
    process.exit(1);
  }

  const postsPath = path.join(__dirname, 'posts.json');
  if (!fs.existsSync(postsPath)) {
    console.error(`ERROR: posts.json database not found at ${postsPath}`);
    process.exit(1);
  }

  // Read the posts database
  let posts = [];
  try {
    const fileData = fs.readFileSync(postsPath, 'utf8');
    posts = JSON.parse(fileData);
  } catch (error) {
    console.error('ERROR: Failed to read or parse posts.json:', error.message);
    process.exit(1);
  }

  // Find the first unpublished post
  const nextPost = posts.find(post => post.published === false);

  if (!nextPost) {
    console.log('NOTICE: No unpublished posts found. Queue is empty.');
    return;
  }

  console.log(`\nAttempting to publish post ID ${nextPost.id}...`);
  console.log(`Content: "${nextPost.text}"`);

  try {
    // Step 1: Create media container
    console.log('Step 1: Creating media container...');
    const containerParams = new URLSearchParams({
      media_type: 'TEXT',
      text: nextPost.text,
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
    console.log(`Media container created successfully. Creation ID: ${creationId}`);

    // Wait for the container to process (Meta recommended)
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

    const postId = publishData.id;
    console.log(`SUCCESS! Thread published successfully. Post ID: ${postId}`);

    // Step 3: Update posts.json status
    nextPost.published = true;
    nextPost.publishedAt = new Date().toISOString();
    nextPost.postId = postId;

    fs.writeFileSync(postsPath, JSON.stringify(posts, null, 2), 'utf8');
    console.log('Updated posts.json successfully.');

  } catch (error) {
    console.error('\nERROR during publication:', error.message);
    process.exit(1);
  }
}

publishNextPost();
