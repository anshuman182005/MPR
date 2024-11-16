const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const path = require('path');
const mongoose = require('mongoose');
const session = require('express-session'); // Import express-session

const app = express();
let notsentemails = [];

// MongoDB setup
mongoose.connect('mongodb+srv://anshumanpandey182005:mydatabase182005@cluster0.lmiye.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
});
const db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function () {
    console.log('Connected to MongoDB');
});

// Session configuration
app.use(
    session({
        secret: 'mysessions778', // Replace with a strong secret
        resave: false,
        saveUninitialized: false,
        cookie: { maxAge: 24 * 60 * 60 * 1000 }, // Session duration (1 day)
    })
);

// Schema and model for storing email and passwords
const userSchema = new mongoose.Schema({
    email: String,
    password: String,
});
const User = mongoose.model('User', userSchema);

// Helper function to validate email
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// Multer setup for file upload
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'uploads/');
    },
    filename: function (req, file, cb) {
        cb(null, file.originalname);
    },
});
const upload = multer({ storage: storage });

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Route to send index.html
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Route to fetch the stored password based on email
app.post('/get-password', async (req, res) => {
    const { email } = req.body;

    if (!isValidEmail(email)) {
        return res.status(400).send('Invalid email format.');
    }

    try {
        const user = await User.findOne({ email });
        if (user) {
            // Store user session if password matches
            req.session.userEmail = email;
            res.json({ password: user.password });
        } else {
            res.json({ password: '' });
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

// Middleware to check for active session
function checkSession(req, res, next) {
    const { senderEmail } = req.body;

    if (req.session.userEmail && req.session.userEmail === senderEmail) {
        // Session is valid for this user
        return next();
    }
    
    // No valid session for this email
    return res.status(401).json({ error: 'Unauthorized access. Please log in from your authorized device.' });
}

// Route to upload the file and send emails (with session check for existing users)
app.post('/upload', upload.single('xlsxFile'), async (req, res) => {
    notsentemails = []; // Clear the array at the beginning of each request
    const senderEmail = req.body.senderEmail;
    const senderPassword = req.body.senderPassword;
    const customMessage = req.body.customMessage;

    if (!isValidEmail(senderEmail)) {
        return res.status(400).send('Invalid sender email.');
    }

    try {
        // Check if the email exists in the database
        let user = await User.findOne({ email: senderEmail });
        
        if (user) {
            // If email exists, validate the session and password
            if (user.password !== senderPassword) {
                user.password = senderPassword;
                await user.save();
            }
            // Check session
            return checkSession(req, res, async () => await sendEmails(req, res, senderEmail, senderPassword, customMessage));
        } else {
            // New user case: create new user and proceed without session
            user = new User({ email: senderEmail, password: senderPassword });
            await user.save();
            // req.session.userEmail = senderEmail;
            return await sendEmails(req, res, senderEmail, senderPassword, customMessage);
        }
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error saving to database.');
    }
});

// Helper function to send emails
async function sendEmails(req, res, senderEmail, senderPassword, customMessage) {
    // Set up email transporter
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: senderEmail, pass: senderPassword },
    });

    const results = [];
    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    data.forEach((row) => {
        const rowData = {};
        row.forEach((cell, columnIndex) => {
            rowData[`Column${columnIndex + 1}`] = cell;
        });
        results.push(rowData);
    });

    const emailPromises = results.map((item) => {
        return new Promise((resolve) => {
            Object.values(item).forEach((value) => {
                if (isValidEmail(value)) {
                    const mailOptions = {
                        from: senderEmail,
                        to: String(value),
                        subject: 'Sending Email using Node.js',
                        text: customMessage || 'That was easy!',
                    };
                    transporter.sendMail(mailOptions, (error, info) => {
                        if (error) {
                            notsentemails.push(value);
                            console.log('Error sending to:', value, error);
                        } else {
                            console.log('Email sent:', info.response);
                        }
                        resolve();
                    });
                } else {
                    resolve();
                }
            });
        });
    });

    Promise.all(emailPromises).then(() => {
        res.json(notsentemails);
    });
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});