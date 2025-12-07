
require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pdp, pep } = require('./index.js');


const PORT = 3001

// system variables where Client credentials are stored
const CLIENT_ID = process.env.GOOGLE_CLIENT_ID
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET
// callback URL configured during Client registration in OIDC provider
const CALLBACK = 'callback'
console.log("CLIENT_ID:", CLIENT_ID);
console.log("CLIENT_SECRET:", CLIENT_SECRET);


const app = express()
app.use(cookieParser())
const sessions = {};
const HARDCODED_REPO = {
    owner: "nodejs",
    repo: "node"
};


function createSession(payload, tokens) {
  const sessionID = crypto.randomBytes(30).toString('hex');
  sessions[sessionID] = {
    email: payload.email,
    role: 'free', // default role; can be changed later (e.g., admin UI or policy)
    tokens: tokens || {},
  };
  return sessionID;
}

app.get('/', (req, resp) => {
    resp.send('<a href=/login>Use Google Account</a>')
})


app.get('/login', (req, resp) => {
    resp.redirect(302,
        // authorization endpoint
        'https://accounts.google.com/o/oauth2/v2/auth?'
        
        // client id
        + 'client_id='+ CLIENT_ID +'&'
        
        // OpenID scope "openid email"
        + 'scope=openid%20email&'
        
        // parameter state is used to check if the user-agent requesting login is the same making the request to the callback URL
        // more info at https://www.rfc-editor.org/rfc/rfc6749#section-10.12
        + 'state=value-based-on-user-session&'
        
        // responde_type for "authorization code grant"
        + 'response_type=code&'
        
        // redirect uri used to register RP
        + 'redirect_uri=http://localhost:'+PORT+'/'+CALLBACK)
})



//
// Exchange the 'code' by the 'access_token' 
// 
app.get('/'+CALLBACK, (req, resp) => {
    //
    // TODO: check if 'state' is correct for this session
    //

    console.log('making request to token endpoint')
    // content-type: application/x-www-form-urlencoded (URL-Encoded Forms)
    const form = new FormData();
    form.append('code', req.query.code);
    form.append('client_id', CLIENT_ID);
    form.append('client_secret', CLIENT_SECRET);
    form.append('redirect_uri', 'http://localhost:'+PORT+'/'+CALLBACK);
    form.append('grant_type', 'authorization_code');

    axios.post(
        // token endpoint
        'https://www.googleapis.com/oauth2/v3/token', 
        // body parameters in form url encoded
        form,
        { headers: form.getHeaders() }
      )
      .then(function (response) {
        // AXIOS assumes by default that response type is JSON: https://github.com/axios/axios#request-config
        // Property response.data should have the JSON response according to schema described here: https://openid.net/specs/openid-connect-core-1_0.html#TokenResponse

        console.log(response.data)
        // decode id_token from base64 encoding
        // note: method decode does not verify signature
        var jwt_payload = jwt.decode(response.data.id_token)
        console.log(jwt_payload)

        const sessionID = createSession(jwt_payload, {
            access_token: response.accessToken,
            refresh_token: response.refreshToken,
            id_token: response.idToken,
            });

        // a simple cookie example
        resp.cookie('sessionID', sessionID, {
            httpOnly: true,
            secure: false,
            sameSite: 'lax'
        });
        // HTML response with the code and access token received from the authorization server
        resp.send(
            '<div> callback with code = <code>' + req.query.code + '</code></div><br>' +
            '<div> client app received access code = <code>' + response.data.access_token + '</code></div><br>' +
            '<div> id_token = <code>' + response.data.id_token + '</code></div><br>' +
            '<div> Hi <b>' + jwt_payload.email + '</b> </div><br>' +
            'Go back to <a href="/">Home screen</a>'
        );
      })
      .catch(function (error) {
        console.log(error)
        resp.send()
      });
})


app.get("/milestones", async (req, res) => {
  const sessionID = req.cookies.sessionID;
  const session = sessions[sessionID];

  if (!session)
    return res.status(401).send("Not authenticated");

  const { owner, repo } = HARDCODED_REPO;

  // Casbin check
  const decision = await pdp(session.role, "repo:milestones", "read");
  pep(decision);

  if (!decision.res)
    return res.status(403).send("Forbidden");

  try {
    const response = await axios.get(
      `https://api.github.com/repos/${owner}/${repo}/milestones`,
      {
        headers: {
          //Authorization: `Bearer ${session.tokens.github}`, // se for privado
          Accept: "application/vnd.github+json",
        },
      }
    );

    res.json(response.data);

  } catch (err) {
    console.log(err);
    res.status(500).send("Erro ao buscar milestones");
  }
});





app.listen(PORT, (err) => {
    if (err) {
        return console.log('something bad happened', err)
    }
    console.log(`server is listening on ${PORT}`)
})