import express from 'express';
import fetch from 'node-fetch';
import cors from 'cors';
import e from 'express';
import dotenv from 'dotenv';


const app = express();
const port = 3000;

// Enable CORS for all origins
app.use(cors());

// Middleware to parse JSON bodies
app.use(express.json());

// Endpoint to fetch Auth Token
app.post('/auth-token', async (req, res) => { 
  // environment variables
  const tenantId = process.env.TENANT_ID;
  const clientId = process.env.CLIENT_ID;  
  const clientSecret = process.env.CLIENT_SECRET;  

  const scope = "https://analysis.windows.net/powerbi/api/.default";
  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

  try {
    const response = await fetch(authUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
        scope: scope
      })
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Auth Token');
    }

    const data = await response.json();
    res.json(data); // Send back the auth token to the frontend
  } catch (error) {
    console.error('Error fetching Auth Token:', error);
    res.status(500).json({ error: 'Failed to fetch Auth Token' });
  }
});

// Endpoint to fetch Embed Token
app.post('/embed-token', async (req, res) => {
  const groupId = "4c6a6199-2d9c-423c-a366-7e72edc983ad";
  const reportId = "9f92cc54-8318-44c4-a671-a020ea14ef56";
  const powerBIUrl = `https://api.powerbi.com/v1.0/myorg/groups/${groupId}/reports/${reportId}/GenerateToken`;

  // Auth token is sent from the frontend
  const authToken = req.body.authToken;

  try {
    const response = await fetch(powerBIUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({ accessLevel: 'View' }) 
    });

    if (!response.ok) {
      throw new Error('Failed to fetch Embed Token');
    }

    const data = await response.json();
    res.json(data); // Send back the embed token and embed URL to the frontend
  } catch (error) {
    console.error('Error fetching Embed Token:', error);
    res.status(500).json({ error: 'Failed to fetch Embed Token' });
  }
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
