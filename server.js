import express from 'express';
import cookieParser from 'cookie-parser';
import axios from 'axios';
import FormData from 'form-data';
import jwt from 'jsonwebtoken';


const express = require('express')
const cookieParser = require('cookie-parser');
const axios = require('axios');
const FormData = require('form-data');
const jwt = require('jsonwebtoken');

const PORT = 3001

// system variables where Client credentials are stored
const CLIENT_ID = process.env.CLIENT_ID
const CLIENT_SECRET = process.env.CLIENT_SECRET
// callback URL configured during Client registration in OIDC provider
const CALLBACK = 'callback'


const app = express()
app.use(cookieParser())


app.listen(PORT, (err) => {
    if (err) {
        return console.log('something bad happened', err)
    }
    console.log(`server is listening on ${PORT}`)
})