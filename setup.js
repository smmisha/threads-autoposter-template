/**
 * Threads API Authorization Helper
 * Developer/Author: socialmediamisha (https://github.com/socialmediamisha)
 * Description: Interactive console helper to generate a long-lived 60-day Meta Threads API access token.
 * License: MIT
 * Copyright (c) 2026 socialmediamisha
 */

const fs = require('fs');
const readline = require('readline/promises');

const { stdin: input, stdout: output } = require('process');

const DEFAULT_APP_ID = '2258368148304501';
const REDIRECT_URI = 'https://localhost:3000/';

async function main() {
  const rl = readline.createInterface({ input, output });

  console.log('\n=== Threads API Authorization Helper ===\n');

  try {
    // 1. Get App ID
    const appId = (await rl.question(`Enter Threads App ID [default: ${DEFAULT_APP_ID}]: `)).trim() || DEFAULT_APP_ID;

    // 2. Get App Secret
    const appSecret = (await rl.question('Enter Threads App Secret: ')).trim();
    if (!appSecret) {
      throw new Error('App Secret is required!');
    }

    // 3. Generate Auth URL
    const authUrl = `https://threads.net/oauth/authorize?client_id=${appId}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&scope=threads_basic,threads_content_publish&response_type=code`;

    console.log('\n----------------------------------------');
    console.log('1. Open the following link in your browser and authorize the application:\n');
    console.log(authUrl);
    console.log('\n2. After authorizing, you will be redirected to a page that may fail to load (this is expected).');
    console.log('   Copy the ENTIRE URL from the browser address bar (it will start with https://localhost:3000/?code=...)');
    console.log('----------------------------------------\n');

    // 4. Get the Redirected URL
    const redirectUrlStr = (await rl.question('Paste the entire redirected URL here: ')).trim();
    if (!redirectUrlStr) {
      throw new Error('Redirected URL is required!');
    }

    // 5. Extract Authorization Code
    let code = '';
    try {
      const parsedUrl = new URL(redirectUrlStr);
      code = parsedUrl.searchParams.get('code');
    } catch (e) {
      // If they just pasted the code instead of the URL
      code = redirectUrlStr;
    }

    if (!code) {
      throw new Error('Could not find authorization code in the provided input.');
    }

    // Strip trailing #_ if Meta appended it
    if (code.endsWith('#_')) {
      code = code.slice(0, -2);
    }

    console.log('\nExchanging code for short-lived access token...');

    // 6. Exchange code for short-lived token
    const tokenParams = new URLSearchParams({
      client_id: appId,
      client_secret: appSecret,
      grant_type: 'authorization_code',
      redirect_uri: REDIRECT_URI,
      code: code
    });

    const shortLivedRes = await fetch('https://graph.threads.net/oauth/access_token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: tokenParams.toString()
    });

    const shortLivedData = await shortLivedRes.json();
    if (!shortLivedRes.ok || shortLivedData.error) {
      throw new Error(`Failed to get short-lived token: ${JSON.stringify(shortLivedData.error || shortLivedData)}`);
    }

    const shortLivedToken = shortLivedData.access_token;
    console.log('Successfully obtained short-lived token!');

    // 7. Exchange short-lived token for long-lived token
    console.log('Exchanging short-lived token for 60-day long-lived token...');
    const refreshUrl = `https://graph.threads.net/access_token?grant_type=th_exchange_token&client_secret=${appSecret}&access_token=${shortLivedToken}`;
    
    const longLivedRes = await fetch(refreshUrl);
    const longLivedData = await longLivedRes.json();

    if (!longLivedRes.ok || longLivedData.error) {
      throw new Error(`Failed to exchange for long-lived token: ${JSON.stringify(longLivedData.error || longLivedData)}`);
    }

    const longLivedToken = longLivedData.access_token;
    console.log('Successfully obtained 60-day long-lived token!');

    // 8. Fetch User Profile
    console.log('Fetching user profile details...');
    const profileRes = await fetch(`https://graph.threads.net/v1.0/me?fields=id,username&access_token=${longLivedToken}`);
    const profileData = await profileRes.json();

    if (!profileRes.ok || profileData.error) {
      throw new Error(`Failed to fetch profile: ${JSON.stringify(profileData.error || profileData)}`);
    }

    const userId = profileData.id;
    const username = profileData.username;
    console.log(`Successfully connected profile: @${username} (ID: ${userId})`);

    // 9. Write to .env file
    const envContent = `THREADS_APP_ID=${appId}
THREADS_APP_SECRET=${appSecret}
THREADS_USER_ID=${userId}
THREADS_USERNAME=${username}
THREADS_ACCESS_TOKEN=${longLivedToken}
`;

    fs.writeFileSync('.env', envContent, 'utf8');
    console.log('\nSUCCESS! Generated .env file successfully.');
    console.log('Ensure this file is kept secret and not committed to git.');

  } catch (error) {
    console.error('\nERROR:', error.message);
  } finally {
    rl.close();
  }
}

main();
