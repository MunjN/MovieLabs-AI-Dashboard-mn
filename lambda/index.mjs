// lambda/index.mjs
//
// AWS Lambda handler to replace your old Express backend.
// Exposes:
//   POST /auth-token   -> gets Azure AD token for Power BI
//   POST /embed-token  -> gets Power BI embed token using that auth token
//
// Environment variables required in Lambda:
//   TENANT_ID
//   CLIENT_ID
//   CLIENT_SECRET
//

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*", // You can later restrict this to your domain
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "OPTIONS,POST",
};

const GROUP_ID = "4c6a6199-2d9c-423c-a366-7e72edc983ad"; // Power BI workspace
const REPORT_ID = "9f92cc54-8318-44c4-a671-a020ea14ef56"; // Power BI report

export const handler = async (event) => {
  try {
    // Support both HTTP API (event.requestContext.http) and REST API (event.httpMethod)
    const method =
      event?.requestContext?.http?.method || event.httpMethod || "GET";
    const path =
      event?.rawPath || event?.path || "/";

    // Handle CORS preflight
    if (method === "OPTIONS") {
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: "",
      };
    }

    // Parse JSON body if present
    let body = {};
    if (event.body) {
      try {
        body = JSON.parse(event.body);
      } catch (e) {
        // If parsing fails, leave body as {}
        console.error("Failed to parse JSON body:", e);
      }
    }

    // Route: POST /auth-token
    if (method === "POST" && normalizePath(path) === "/auth-token") {
      return await handleAuthToken();
    }

    // Route: POST /embed-token
    if (method === "POST" && normalizePath(path) === "/embed-token") {
      return await handleEmbedToken(body);
    }

    // Not found
    return {
      statusCode: 404,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Not found" }),
    };
  } catch (err) {
    console.error("Unhandled error in handler:", err);
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Internal server error" }),
    };
  }
};

// Utility: normalize path to avoid trailing-slash issues
function normalizePath(path) {
  if (!path) return "/";
  const noQuery = path.split("?")[0];
  return noQuery.endsWith("/") && noQuery !== "/"
    ? noQuery.slice(0, -1)
    : noQuery;
}

// POST /auth-token
async function handleAuthToken() {
  const TENANT_ID = process.env.TENANT_ID;
  const CLIENT_ID = process.env.CLIENT_ID;
  const CLIENT_SECRET = process.env.CLIENT_SECRET;

  if (!TENANT_ID || !CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing Azure AD env vars");
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: "Server is missing TENANT_ID, CLIENT_ID, or CLIENT_SECRET",
      }),
    };
  }

  const authUrl = `https://login.microsoftonline.com/${TENANT_ID}/oauth2/v2.0/token`;
  const scope = "https://analysis.windows.net/powerbi/api/.default";

  const params = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: CLIENT_ID,
    client_secret: CLIENT_SECRET,
    scope,
  });

  const response = await fetch(authUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params,
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Auth token request failed:", response.status, text);
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Failed to fetch auth token" }),
    };
  }

  const data = await response.json();

  return {
    statusCode: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  };
}

// POST /embed-token
async function handleEmbedToken(body) {
  const authToken = body.authToken;

  if (!authToken) {
    return {
      statusCode: 400,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Missing 'authToken' in request body" }),
    };
  }

  const url = `https://api.powerbi.com/v1.0/myorg/groups/${GROUP_ID}/reports/${REPORT_ID}/GenerateToken`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${authToken}`,
    },
    body: JSON.stringify({ accessLevel: "View" }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Embed token request failed:", response.status, text);
    return {
      statusCode: 500,
      headers: {
        ...CORS_HEADERS,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ error: "Failed to get embed token" }),
    };
  }

  const data = await response.json();

  return {
    statusCode: 200,
    headers: {
      ...CORS_HEADERS,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  };
}
