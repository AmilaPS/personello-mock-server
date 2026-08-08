require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const session = require('express-session'); 
const os = require('os');
const cron = require('node-cron');
const crypto = require('crypto');

const app = express();

const authTokens = new Map();

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const interfaceName in interfaces) {
        for (const net of interfaces[interfaceName]) {
            if (net.family === 'IPv4' && !net.internal) {
                return net.address;
            }
        }
    }
    return 'localhost';
}

const NETWORK_IP = getLocalIP(); 
const ULF_PORT = process.env.PORT || process.env.ULF_PORT || 5002; 
const CARD_APP_PORT = process.env.CARD_APP_PORT || 3000; 

const CARD_APP_URL = process.env.CARD_APP_URL || `http://${NETWORK_IP}:${CARD_APP_PORT}`;

app.use(cors({
    origin: [CARD_APP_URL, `http://localhost:${CARD_APP_PORT}`, `http://127.0.0.1:${CARD_APP_PORT}`],
    credentials: true
})); 

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(cookieParser());

app.use(session({
    secret: 'ulf_secure_secret_key_2026', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' } 
}));

const rootDir = __dirname; 
const viewsDir = path.join(rootDir, 'views'); 
const storageDir = path.join(rootDir, 'ulf_storage', 'Cards'); 
const webpageFolder = path.join(viewsDir, 'personelloweb'); 

if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true }); 
}

app.use('/views', express.static(viewsDir)); 
app.use('/views/ulf_storage', express.static(path.join(rootDir, 'ulf_storage')));

const sqlite3 = require('sqlite3').verbose(); 
const bcrypt = require('bcrypt'); 
const dbPath = path.join(rootDir, 'personello.db'); 
const db = new sqlite3.Database(dbPath); 

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'User',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, storageDir); }, 
    filename: (req, file, cb) => { cb(null, 'temp_' + Date.now() + '_' + file.originalname); }
});
const upload = multer({ storage: storage }); 

function renderPage(contentFileName, res) {
    try {
        const headerHtml = fs.readFileSync(path.join(webpageFolder, 'header.html'), 'utf8'); 
        const contentHtml = fs.readFileSync(path.join(webpageFolder, contentFileName), 'utf8'); 
        const footerHtml = fs.readFileSync(path.join(webpageFolder, 'footer.html'), 'utf8'); 
        res.send(headerHtml + contentHtml + footerHtml); 
    } catch (err) {
        console.error(`[Ulf Server] Error assembling ${contentFileName}:`, err.message); 
        res.status(500).send("Server Error: Unable to assemble page components."); 
    }
}

// -----------------------------------------------------------------
// 1. ROUTING - FRONTEND VIEWS
// -----------------------------------------------------------------

app.get('/', (req, res) => {
    if (req.session.user) return res.redirect('/mypersonello'); 
    renderPage('login_content.html', res); 
});

app.get('/mypersonello/login', (req, res) => {
    if (req.session.user) return res.redirect('/mypersonello'); 
    renderPage('login_content.html', res); 
});

app.get('/mypersonello/register', (req, res) => {
    if (req.session.user) return res.redirect('/mypersonello'); 
    renderPage('register.html', res); 
});

app.get('/mypersonello/register_admin', (req, res) => {
    if (req.session.user) return res.redirect('/mypersonello'); 
    renderPage('admin_register.html', res); 
});

app.get('/mypersonello', (req, res) => {
    if (!req.session.user) return res.redirect('/mypersonello/login?error=unauthorized'); 
    
    const userId = req.session.user.id; 
    const userRole = (req.session.user.role === 'Admin' || req.session.user.role === 'pro') ? 'Admin' : 'User';

    try {
        const headerHtml = fs.readFileSync(path.join(webpageFolder, 'header.html'), 'utf8'); 
        let contentHtml = fs.readFileSync(path.join(webpageFolder, 'meinkonto_content.html'), 'utf8'); 
        const footerHtml = fs.readFileSync(path.join(webpageFolder, 'footer.html'), 'utf8'); 

        const token = crypto.randomBytes(16).toString('hex');
        authTokens.set(token, { userId: userId, role: userRole, expires: Date.now() + 60000 });

        const generateLink = `${CARD_APP_URL}/home?token=${token}`;
        
        // 🚀 DYNAMIC PLACEHOLDERS REPLACED HERE
        contentHtml = contentHtml.split('{{GENERATE_LINK}}').join(generateLink);
        contentHtml = contentHtml.replaceAll('{{CARD_APP_URL}}', CARD_APP_URL);

        if (userRole === 'Admin') {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '<span class="pso-pro-badge">Admin</span>');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '<div class="pso-mobile-pro-wrapper"><span class="pso-pro-badge">Admin</span></div>');
        } else {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '');
        }

        res.send(headerHtml + contentHtml + footerHtml); 
    } catch (err) {
        console.error(`[Ulf Server] Error assembling mypersonello:`, err.message); 
        res.status(500).send("Server Error"); 
    }
});

app.get('/mypersonello/karten', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/mypersonello/login?error=unauthorized'); 
    }

    const userId = req.session.user.id; 
    const userRole = (req.session.user.role === 'Admin' || req.session.user.role === 'pro') ? 'Admin' : 'User';
    const webpageFolder = path.join(__dirname, 'views', 'personelloweb'); 

    try {
        const headerHtml = fs.readFileSync(path.join(webpageFolder, 'header.html'), 'utf8'); 
        let contentHtml = fs.readFileSync(path.join(webpageFolder, 'karten_content.html'), 'utf8'); 
        const footerHtml = fs.readFileSync(path.join(webpageFolder, 'footer.html'), 'utf8'); 
        
        const token = crypto.randomBytes(16).toString('hex');
        authTokens.set(token, { userId: userId, role: userRole, expires: Date.now() + 60000 });

        const generateLink = `${CARD_APP_URL}/home?token=${token}`;
        
        // 🚀 DYNAMIC PLACEHOLDERS REPLACED HERE
        contentHtml = contentHtml.split('{{GENERATE_LINK}}').join(generateLink);
        contentHtml = contentHtml.replaceAll('{{CARD_APP_URL}}', CARD_APP_URL);

        if (userRole === 'Admin') {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '<span class="pso-pro-badge">Admin</span>');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '<div class="pso-mobile-pro-wrapper"><span class="pso-pro-badge">Admin</span></div>');
        } else {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '');
        }
        
        res.send(headerHtml + contentHtml + footerHtml); 

    } catch (err) {
        console.error(`[Ulf Server] Cards Error:`, err.message); 
        res.status(500).send("Server Error"); 
    }
});

// -----------------------------------------------------------------
// 2. AUTHENTICATION APIs (Register, Login & Token Verify)
// -----------------------------------------------------------------

app.post('/api/auth/register', async (req, res) => {
    try {
        const { frmStr_email, frmStr_password, frmStr_password_repeat, user_type } = req.body; 
        if (!frmStr_email || !frmStr_password || !frmStr_password_repeat) return res.status(400).send("<h3>Fehler: Alle Felder sind Pflichtfelder!</h3>"); 
        if (frmStr_password !== frmStr_password_repeat) return res.status(400).send("<h3>Fehler: Passwörter stimmen nicht überein!</h3>"); 

        const assignedRole = (user_type === 'admin' || user_type === 'pro') ? 'Admin' : 'User'; 

        db.get(`SELECT id FROM users WHERE email = ?`, [frmStr_email], async (err, row) => { 
            if (err) return res.status(500).send("Server Error"); 
            if (row) return res.status(400).send("<h3>Fehler: Diese E-Mail-Adresse wird bereits verwendet!</h3>"); 

            const hashedPassword = await bcrypt.hash(frmStr_password, 10); 
            
            db.run(`INSERT INTO users (email, password, role) VALUES (?, ?, ?)`, [frmStr_email, hashedPassword, assignedRole], function(err) { 
                if (err) return res.status(500).send("Registration failed."); 
                res.redirect('/mypersonello/login?status=success'); 
            });
        });
    } catch (err) { res.status(500).send(err.message); } 
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { frmStr_email, frmStr_password } = req.body; 
        if (!frmStr_email || !frmStr_password) return res.status(400).send("<h3>Fehler: E-Mail und Passwort erforderlich!</h3>"); 

        db.get(`SELECT * FROM users WHERE email = ?`, [frmStr_email], async (err, user) => { 
            if (err) return res.status(500).send("Server Error"); 
            if (!user) return res.status(400).send("<h3>Fehler: Ungültige E-Mail-Adresse oder Passwort!</h3>"); 

            const isMatch = await bcrypt.compare(frmStr_password, user.password); 
            if (!isMatch) return res.status(400).send("<h3>Fehler: Ungültige E-Mail-Adresse oder Passwort!</h3>"); 

            const currentRole = (user.role === 'Admin' || user.role === 'pro') ? 'Admin' : 'User';

            req.session.user = { id: user.id, email: user.email, role: currentRole }; 
            
            const cookieOptions = { 
                maxAge: 24 * 60 * 60 * 1000, 
                httpOnly: false, 
                sameSite: 'lax' 
            };

            res.cookie('main_user_id', user.id, cookieOptions); 
            res.cookie('user_role', currentRole, cookieOptions); 
            
            res.redirect('/mypersonello'); 
        });
    } catch (err) { res.status(500).send(err.message); } 
});

app.get('/api/auth/verify-token', (req, res) => {
    const token = req.query.token;

    if (!token || !authTokens.has(token)) {
        return res.json({ valid: false, message: "Invalid or used token" });
    }

    const tokenData = authTokens.get(token);

    if (Date.now() > tokenData.expires) {
        authTokens.delete(token);
        return res.json({ valid: false, message: "Token expired" });
    }

    const verifiedUserId = tokenData.userId;
    const verifiedRole = tokenData.role || 'User';
    authTokens.delete(token);

    res.json({ valid: true, user_id: verifiedUserId, user_role: verifiedRole });
});

app.get('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => { 
        if (err) console.error(err); 
        res.clearCookie('main_user_id'); 
        res.clearCookie('user_role');   
        res.redirect('/mypersonello/login'); 
    });
});

// -----------------------------------------------------------------
// 3. ADAPTIVE AUTO-COPY UPLOAD API
// -----------------------------------------------------------------
app.post('/api/ulf/upload', upload.single('file'), (req, res) => { 
    try {
        if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded.' }); 
        
        const targetUserId = req.body.user_id || req.query.user_id || 1; 
        const targetCardId = req.body.card_id || req.query.card_id || 'christmas_white'; 
        
        const generationId = req.body.generation_id || Date.now(); 
        const fileExt = path.extname(req.file.originalname); 
        
        const adaptiveFileName = `user_${targetUserId}_card_${targetCardId}_${generationId}${fileExt}`; 
        const finalPath = path.join(storageDir, adaptiveFileName); 
        
        fs.renameSync(req.file.path, finalPath); 

        console.log(`\n[Ulf Server] 📥 File Received & Adapted: ${adaptiveFileName}`); 
        
        res.json({ success: true, filename: adaptiveFileName }); 
    } catch (err) { 
        console.error('[Ulf Server] Upload Error:', err.message); 
        res.status(500).json({ success: false, error: err.message }); 
    }
});

app.get('/api/ulf/my-cards', (req, res) => { 
    const userId = req.cookies.main_user_id || 1; 
    const storageDir = path.join(__dirname, 'ulf_storage', 'Cards'); 

    if (!fs.existsSync(storageDir)) return res.json([]); 

    fs.readdir(storageDir, (err, files) => { 
        if (err) return res.status(500).json({ error: "Read error" }); 

        const userFiles = files
            .filter(f => f.startsWith(`user_${userId}_card_`)) 
            .map(f => `/views/ulf_storage/Cards/${f}`);  

        res.json(userFiles); 
    });
});

app.delete('/api/ulf/purge/:generation_key', (req, res) => { 
    const userId = req.cookies.main_user_id || 1; 
    const generationKey = req.params.generation_key;  
    const storageDir = path.join(__dirname, 'ulf_storage', 'Cards'); 

    if (!fs.existsSync(storageDir)) return res.json({ status: "success" }); 

    fs.readdir(storageDir, (err, files) => { 
        if (err) return res.status(500).json({ message: "Read error" }); 

        const targets = files.filter(f => f.startsWith(`user_${userId}_card_${generationKey}`)); 

        targets.forEach(file => { 
            try {
                fs.unlinkSync(path.join(storageDir, file)); 
                console.log(`[Purged Specific File]: ${file}`); 
            } catch (e) {
                console.error(`Failed to delete file: ${file}`, e); 
            }
        });

        res.json({ status: "success" }); 
    });
});

function cleanOldStorageFiles() {
    if (!fs.existsSync(storageDir)) return;

    fs.readdir(storageDir, (err, files) => {
        if (err) {
            console.error(`[Ulf Cleanup] Error reading storage directory:`, err.message);
            return;
        }

        const now = Date.now();
        const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000;

        files.forEach(file => {
            const filePath = path.join(storageDir, file);

            fs.stat(filePath, (err, stats) => {
                if (err) return;

                if (stats.isFile() && (now - stats.mtimeMs > FOURTEEN_DAYS_MS)) {
                    fs.unlink(filePath, (err) => {
                        if (err) {
                            console.error(`[Ulf Cleanup] Failed to delete old file: ${file}`, err.message);
                        } else {
                            console.log(`🗑️ [Ulf Cleanup] Auto-Deleted 14+ Days Old File: ${file}`);
                        }
                    });
                }
            });
        });
    });
}

cron.schedule('0 */4 * * *', () => {
    console.log(`[Ulf Cleanup Engine] Running scheduled check (every 4 hours) for files older than 14 days in ulf_storage/Cards...`);
    cleanOldStorageFiles();
});

app.listen(ULF_PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 ULF AUTH & STORAGE SERVER ONLINE ON PORT: ${ULF_PORT}`);
    console.log(`📱 TARGET CARD APP SERVER: ${CARD_APP_URL}`);
    console.log(`======================================================`);
});
