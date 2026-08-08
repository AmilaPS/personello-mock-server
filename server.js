require('dotenv').config(); 
const express = require('express');
const cors = require('cors');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const cookieParser = require('cookie-parser');
const session = require('express-session'); 
const os = require('os'); // 👈 Active IP එක Auto Detect කිරීම සඳහා os module එක
const cron = require('node-cron');

const app = express();

// 🚀 Active Wi-Fi/LAN IP එක Auto සොයාගන්නා Engine එක
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

// =================================================================
// 🎯 ENVIRONMENT CONFIGURATION LINKING (.env + Cloud/Auto IP)
// =================================================================
const NETWORK_IP = getLocalIP(); 
const ULF_PORT = process.env.PORT || process.env.ULF_PORT || 5002; 
const CARD_APP_PORT = process.env.CARD_APP_PORT || 3000; 

// Railway Public URL එක ඇත්නම් එය ගනී, නැත්නම් Local IP එක පාවිච්චි කරයි
const CARD_APP_URL = process.env.CARD_APP_URL || `http://${NETWORK_IP}:${CARD_APP_PORT}`;
// =================================================================

// 🎯 CardApp සහ ULF Server අතර Cookies / Sessions හුවමාරුවට CORS සකස් කිරීම
app.use(cors({
    origin: [CARD_APP_URL, `http://localhost:${CARD_APP_PORT}`, `http://127.0.0.1:${CARD_APP_PORT}`],
    credentials: true
})); 

app.use(express.json()); 
app.use(express.urlencoded({ extended: true })); 
app.use(cookieParser());

// Session සැකසුම් (User ලොග් වී සිටින බව මතක තබා ගැනීමට)
app.use(session({
    secret: 'ulf_secure_secret_key_2026', 
    resave: false, 
    saveUninitialized: false, 
    cookie: { maxAge: 24 * 60 * 60 * 1000, sameSite: 'lax' } 
}));

// Dynamic Directory Paths සකස් කිරීම
const rootDir = __dirname; 
const viewsDir = path.join(rootDir, 'views'); 
const storageDir = path.join(rootDir, 'ulf_storage', 'Cards'); 
const webpageFolder = path.join(viewsDir, 'personelloweb'); 

if (!fs.existsSync(storageDir)) {
    fs.mkdirSync(storageDir, { recursive: true }); 
}

app.use('/views', express.static(viewsDir)); 
app.use('/views/ulf_storage', express.static(path.join(rootDir, 'ulf_storage')));

// SQLite3 සහ Bcrypt සම්බන්ධ කිරීම
const sqlite3 = require('sqlite3').verbose(); 
const bcrypt = require('bcrypt'); 
const dbPath = path.join(rootDir, 'personello.db'); 
const db = new sqlite3.Database(dbPath); 

// Users Table එක නිර්මාණය
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            role TEXT DEFAULT 'regular',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// Multer Config
const storage = multer.diskStorage({
    destination: (req, file, cb) => { cb(null, storageDir); }, 
    filename: (req, file, cb) => { cb(null, 'temp_' + Date.now() + '_' + file.originalname); }
});
const upload = multer({ storage: storage }); 

// පොදු TEMPLATE FUNCTION එක
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

app.get('/mypersonello/register_pro', (req, res) => {
    if (req.session.user) return res.redirect('/mypersonello'); 
    renderPage('pro_register.html', res); 
});

// 'meinkonto_content.html' පිටුවේ Pro Badge එක replace කිරීම
app.get('/mypersonello', (req, res) => {
    if (!req.session.user) return res.redirect('/mypersonello/login?error=unauthorized'); 
    
    const userId = req.session.user.id; 

    try {
        const headerHtml = fs.readFileSync(path.join(webpageFolder, 'header.html'), 'utf8'); 
        let contentHtml = fs.readFileSync(path.join(webpageFolder, 'meinkonto_content.html'), 'utf8'); 
        const footerHtml = fs.readFileSync(path.join(webpageFolder, 'footer.html'), 'utf8'); 

        // 🚀 Dynamic CardApp Auto IP ලින්ක් එක සකසයි
        const generateLink = `${CARD_APP_URL}/home?user_id=${userId}`;
        
        contentHtml = contentHtml.split('{{GENERATE_LINK}}').join(generateLink);

        if (req.session.user.role === 'pro') {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '<span class="pso-pro-badge">Pro</span>');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '<div class="pso-mobile-pro-wrapper"><span class="pso-pro-badge">Pro</span></div>');
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

// 'karten_content.html' පිටුවේ මොබයිල් ලින්ක් එක replace කිරීම
app.get('/mypersonello/karten', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/mypersonello/login?error=unauthorized'); 
    }

    const userId = req.session.user.id; 
    const webpageFolder = path.join(__dirname, 'views', 'personelloweb'); 

    try {
        const headerHtml = fs.readFileSync(path.join(webpageFolder, 'header.html'), 'utf8'); 
        let contentHtml = fs.readFileSync(path.join(webpageFolder, 'karten_content.html'), 'utf8'); 
        const footerHtml = fs.readFileSync(path.join(webpageFolder, 'footer.html'), 'utf8'); 
        
        // 🚀 Dynamic Auto IP ලින්ක් එක සාදයි
        const generateLink = `${CARD_APP_URL}/home?user_id=${userId}`;
        
        contentHtml = contentHtml.split('{{GENERATE_LINK}}').join(generateLink);

        if (req.session.user.role === 'pro') {
            contentHtml = contentHtml.replace('{{PC_PRO_BADGE}}', '<span class="pso-pro-badge">Pro</span>');
            contentHtml = contentHtml.replace('{{MOBILE_PRO_BADGE}}', '<div class="pso-mobile-pro-wrapper"><span class="pso-pro-badge">Pro</span></div>');
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
// 2. AUTHENTICATION APIs (Register & Login)
// -----------------------------------------------------------------

app.post('/api/auth/register', async (req, res) => {
    try {
        const { frmStr_email, frmStr_password, frmStr_password_repeat, user_type } = req.body; 
        if (!frmStr_email || !frmStr_password || !frmStr_password_repeat) return res.status(400).send("<h3>Fehler: Alle Felder sind Pflichtfelder!</h3>"); 
        if (frmStr_password !== frmStr_password_repeat) return res.status(400).send("<h3>Fehler: Passwörter stimmen nicht überein!</h3>"); 

        const assignedRole = (user_type === 'pro') ? 'pro' : 'regular'; 

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

            req.session.user = { id: user.id, email: user.email, role: user.role || 'regular' }; 
            
            // 🎯 CardApp Server (Port 3000) එකට Cookies ලබාගත හැකි වන පරිදි Cookie Options සකස් කිරීම
            const cookieOptions = { 
                maxAge: 24 * 60 * 60 * 1000, 
                httpOnly: false, 
                sameSite: 'lax' 
            };

            res.cookie('main_user_id', user.id, cookieOptions); 
            res.cookie('user_role', user.role || 'regular', cookieOptions); 
            
            res.redirect('/mypersonello'); 
        });
    } catch (err) { res.status(500).send(err.message); } 
});

// 🔐 SECURE USER VERIFICATION API (Session Check එක සමඟ)
app.get('/api/auth/verify-user', (req, res) => {
    const userId = req.query.user_id;

    // 1. පරිශීලකයා Username/Password ගසා සැබැවින්ම Log වී ඇත්දැයි (Session එකක් තිබේදැයි) බලයි
    if (!req.session || !req.session.user) {
        return res.json({ valid: false, message: "User not logged in on Mock Server" });
    }

    // 2. Active Session එකේ ඉන්න User ID එකයි URL එකේ එන ID එකයි 100% ක් සමානදැයි බලයි
    if (String(req.session.user.id) === String(userId)) {
        return res.json({ valid: true });
    }

    // වෙන කෙනෙකුගේ ID එකක් URL එකේ ගැහුවොත් Block කරයි
    res.json({ valid: false });
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

// =================================================================
// ⏰ ULF STORAGE CLEANUP ENGINE (EVERY 4 HOURS - DELETE FILES > 14 DAYS)
// =================================================================
function cleanOldStorageFiles() {
    if (!fs.existsSync(storageDir)) return;

    fs.readdir(storageDir, (err, files) => {
        if (err) {
            console.error(`[Ulf Cleanup] Error reading storage directory:`, err.message);
            return;
        }

        const now = Date.now();
        const FOURTEEN_DAYS_MS = 14 * 24 * 60 * 60 * 1000; // දවස් 14 ක කාලය මිලි තත්පර වලින්

        files.forEach(file => {
            const filePath = path.join(storageDir, file);

            fs.stat(filePath, (err, stats) => {
                if (err) return;

                // ෆයිල් එකක් නම් සහ එහි අවසාන වෙනස්කම් කළ කාලය දවස් 14 ට වඩා වැඩිය නම්
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

// 🎯 සෑම පැය 4කට වරක්ම මේ පරීක්ෂාව ක්‍රියාත්මක වේ (0 */4 * * *)
cron.schedule('0 */4 * * *', () => {
    console.log(`[Ulf Cleanup Engine] Running scheduled check (every 4 hours) for files older than 14 days in ulf_storage/Cards...[cite: 15]`);
    cleanOldStorageFiles();
});

// -----------------------------------------------------------------
// 4. SERVER INITIALIZATION 
// -----------------------------------------------------------------
app.listen(ULF_PORT, '0.0.0.0', () => {
    console.log(`\n======================================================`);
    console.log(`🚀 ULF AUTH & STORAGE SERVER ONLINE ON PORT: ${ULF_PORT}`);
    console.log(`📱 TARGET CARD APP SERVER: ${CARD_APP_URL}`);
    console.log(`======================================================`);
});
