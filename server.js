require('dotenv').config();

const express = require('express');
const cookieParser = require('cookie-parser');
const axios = require('axios');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const { pdp, pep } = require('./index.js');

const PORT = 3001;

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

const CALLBACK = 'callback';

const app = express();
app.use(cookieParser());

const sessions = {};

const HARDCODED_REPO = {
    owner: "Diogosousa03",
    repo: "CD"
};

// ------------------------------------------------------
// SESSION CREATION
// ------------------------------------------------------
function createSession(payload, tokens) {
    const sessionID = crypto.randomBytes(30).toString("hex");

    sessions[sessionID] = {
        email: payload.email,
        role: "free",
        tokens: tokens || {},
    };

    return sessionID;
}

// ------------------------------------------------------
// HOME
// ------------------------------------------------------
app.get("/", (req, res) => {
    const sessionID = req.cookies.sessionID;
    const session = sessions[sessionID];

    if (!session) {
        return res.send(`
            <h2>You are not logged in</h2>
            <a href="/login">Login with Google</a>
        `);
    }

    res.send(`
    <h2>Welcome, ${session.email}</h2>
    <p>Your role: <b>${session.role}</b></p>

    ${
        session.github_token
        ? `<a href="/milestones/github">View Milestones (GitHub)</a>`
        : `<a href="/github/login">Login with GitHub</a>`
    }

    <br><br>
    <a href="/logout">Logout</a>
`);
});

// ------------------------------------------------------
// GOOGLE LOGIN
// ------------------------------------------------------
app.get("/login", (req, res) => {
    res.redirect(
        "https://accounts.google.com/o/oauth2/v2/auth?" +
        `client_id=${CLIENT_ID}&` +
        `scope=openid%20email%20https://www.googleapis.com/auth/tasks&` +
        `response_type=code&` +
        `redirect_uri=http://localhost:${PORT}/${CALLBACK}`
    );
});

// ------------------------------------------------------
// GOOGLE CALLBACK (corrigido)
// ------------------------------------------------------
app.get("/callback", (req, res) => {
    const form = new FormData();
    form.append("code", req.query.code);
    form.append("client_id", CLIENT_ID);
    form.append("client_secret", CLIENT_SECRET);
    form.append("redirect_uri", `http://localhost:${PORT}/${CALLBACK}`);
    form.append("grant_type", "authorization_code");

    axios.post("https://www.googleapis.com/oauth2/v3/token", form, {
        headers: form.getHeaders()
    })
    .then(async response => {
        const payload = jwt.decode(response.data.id_token);
        const access = response.data.access_token;

        // 1️⃣ OBTER LISTAS DO GOOGLE TASKS
        const lists = await axios.get(
            "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
            {
                headers: { Authorization: `Bearer ${access}` }
            }
        );

        let listId;

        if (lists.data.items?.length > 0) {
            listId = lists.data.items[0].id;
        } else {
            // 2️⃣ CRIAR LISTA SE NÃO EXISTIR NENHUMA
            const newList = await axios.post(
                "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
                { title: "My Tasks" },
                { headers: { Authorization: `Bearer ${access}` } }
            );
            listId = newList.data.id;
        }

        // 3️⃣ GUARDAR SESSION COM TASKLIST
        const sessionID = createSession(payload, {
            access_token: access,
            id_token: response.data.id_token,
            tasklist: listId,
        });

        sessions[sessionID].tasklist = listId;

        res.cookie("sessionID", sessionID, { httpOnly: true });

        res.redirect("/");
    })
    .catch(err => {
        console.log(err);
        res.send("Google login failed");
    });
});

// ------------------------------------------------------
// GITHUB LOGIN
// ------------------------------------------------------
app.get("/github/login", (req, res) => {
    const url =
        "https://github.com/login/oauth/authorize?" +
        `client_id=${process.env.GITHUB_CLIENT_ID}&` +
        `scope=repo`;

    res.redirect(url);
});

// ------------------------------------------------------
// GITHUB CALLBACK
// ------------------------------------------------------
app.get("/github/callback", async (req, res) => {
    const code = req.query.code;

    const tokenRes = await axios.post(
        "https://github.com/login/oauth/access_token",
        {
            client_id: process.env.GITHUB_CLIENT_ID,
            client_secret: process.env.GITHUB_CLIENT_SECRET,
            code: code
        },
        { headers: { Accept: "application/json" } }
    );

    const accessToken = tokenRes.data.access_token;

    const sessionID = req.cookies.sessionID;

    if (!sessions[sessionID]) {
        return res.send("Please login with Google first.");
    }
    sessions[sessionID].github_token = accessToken;
    sessions[sessionID].role = "premium";

    res.redirect("/milestones/github");
});

// ------------------------------------------------------
// LIST MILESTONES
// ------------------------------------------------------
app.get("/milestones/github", async (req, res) => {
    const sessionID = req.cookies.sessionID;
    const session = sessions[sessionID];

    if (!session)
        return res.status(401).send("Not authenticated");

    const { owner, repo } = HARDCODED_REPO;

    const decision = await pdp(session.role, "repo:milestones", "read");
    pep(decision);

    if (!decision.res) {
        return res.status(403).send("Forbidden");
    }

    try {
        const response = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/milestones`,
            {
                headers: {
                    Authorization: `Bearer ${session.github_token}`,
                    Accept: "application/vnd.github+json",
                },
            }
        );

        const milestones = response.data;

        let html = "<h2>Select a milestone to create a Google Task</h2>";

        milestones.forEach(m => {
            html += `
                <div style="margin:10px;">
                    <a href="/milestone/create-task/${m.number}">
                         ${m.title}
                    </a>
                </div>
            `;
        });

        res.send(html);

    } catch (err) {
        console.log(err);
        res.status(500).send("Could not load milestones");
    }
});

// ------------------------------------------------------
// CREATE GOOGLE TASK (corrigido)
// ------------------------------------------------------
// ------------------------------------------------------
// CREATE GOOGLE TASK (regular + premium)
// ------------------------------------------------------
app.get("/milestone/create-task/:id", async (req, res) => {
    const sessionID = req.cookies.sessionID;
    const session = sessions[sessionID];

    if (!session)
        return res.status(401).send("Not authenticated");

    // --- Casbin check ---
    const decision = await pdp(session.role, "milestone:task_create", "create_custom_list");
    pep(decision);

    // free users cannot create tasks
    if (!decision.res) {
        return res.status(403).send("Forbidden — your role cannot create tasks");
    }

    const milestoneId = req.params.id;
    const { owner, repo } = HARDCODED_REPO;

    try {
        // ✅ 1. Fetch milestone
        const milestone = await axios.get(
            `https://api.github.com/repos/${owner}/${repo}/milestones/${milestoneId}`,
            {
                headers: {
                    Authorization: `Bearer ${session.github_token}`,
                    Accept: "application/vnd.github+json",
                },
            }
        );

        const title = milestone.data.title;

        let listId = session.tasklist; // default list

        // ----------------------------------------------------------
        // ✅ PREMIUM users → create custom list using milestone name
        // ----------------------------------------------------------
        if (session.role === "premium") {
            // Casbin check for premium list creation
            const decPremium = await pdp(session.role, "milestone:task_create", "create_custom_list");
            pep(decPremium);

            if (!decPremium.res) {
                return res.status(403).send("Forbidden — premium cannot create custom lists (policy mismatch)");
            }

            // Create custom list
            const newList = await axios.post(
                "https://tasks.googleapis.com/tasks/v1/users/@me/lists",
                { title: title },
                {
                    headers: {
                        Authorization: `Bearer ${session.tokens.access_token}`,
                        "Content-Type": "application/json",
                    },
                }
            );

            listId = newList.data.id; // ✅ use the new list
        }

        // ----------------------------------------------------------
        // ✅ Create the task inside listId (default or premium list)
        // ----------------------------------------------------------
        await axios.post(
            `https://tasks.googleapis.com/tasks/v1/lists/${listId}/tasks`,
            { title: title },
            {
                headers: {
                    Authorization: `Bearer ${session.tokens.access_token}`,
                    "Content-Type": "application/json",
                },
            }
        );

        res.send(`
            <h3>✅ Task Created!</h3>
            <p>Milestone: <b>${title}</b></p>
            <p>List ID: <b>${listId}</b></p>
            <a href="/milestones/github">Back</a>
        `);

    } catch (err) {
        console.log(err);
        res.status(500).send("Could not create Google Task");
    }
});

// ------------------------------------------------------
// START SERVER
// ------------------------------------------------------
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
