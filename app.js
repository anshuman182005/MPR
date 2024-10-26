const express = require('express');
const multer = require('multer');
const xlsx = require('xlsx');
const nodemailer = require('nodemailer');
const path = require('path');
const mongoose = require('mongoose');
const app = express();

var notsentemails = [];

// MongoDB setup
mongoose.connect('mongodb+srv://anshumanpandey182005:mydatabase182005@cluster0.lmiye.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0', { useNewUrlParser: true, useUnifiedTopology: true });
const db = mongoose.connection;

db.on('error', console.error.bind(console, 'connection error:'));
db.once('open', function() {
    console.log('Connected to MongoDB');
});

// Create schema and model for storing email and passwords
const userSchema = new mongoose.Schema({
    email: String,
    password: String
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
    }
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
            // Send the stored password back to the client
            res.json({ password: user.password });
        } else {
            res.json({ password: '' }); // No password found for this email
        }
    } catch (err) {
        console.error(err);
        res.status(500).send('Server error.');
    }
});

// Route to upload the file and send emails
app.post('/upload', upload.single('xlsxFile'), async (req, res) => {
    notsentemails = []; // Reset for each request

    if (!req.file) {
        return res.status(400).send('No file uploaded.');
    }

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
            if (user.password !== senderPassword) {
                user.password = senderPassword;
                await user.save();
            }
        } else {
            user = new User({ email: senderEmail, password: senderPassword });
            await user.save();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).send('Error saving to database.');
    }

    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: { user: senderEmail, pass: senderPassword }
    });

    const workbook = xlsx.readFile(req.file.path);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });

    const results = [];
    data.forEach(row => {
        const rowData = {};
        row.forEach((cell, columnIndex) => {
            rowData[`Column${columnIndex + 1}`] = cell;
        });
        results.push(rowData);
    });

    let emailPromises = results.map(item => {
        return new Promise((resolve) => {
            Object.values(item).forEach(async (value) => {
                if (isValidEmail(value)) {
                    const mailOptions = {
                        from: senderEmail,
                        to: String(value),
                        subject: 'Sending Email using Node.js',
                        text: customMessage || 'That was easy!'
                    };

                    try {
                        const info = await transporter.sendMail(mailOptions);
                        console.log(`Email sent to ${value}: ${info.response}`);
                    } catch (error) {
                        console.error(`Error sending to ${value}:`, error.message);
                        notsentemails.push({ email: value, error: error.message });
                    } finally {
                        resolve(); // Resolve the promise after processing
                    }
                } else {
                    resolve(); // Skip invalid email
                }
            });
        });
    });

    Promise.all(emailPromises).then(() => {
        res.json({ failedEmails: notsentemails }); // Send list of failed emails and error reasons to frontend
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});