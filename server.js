const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const { authenticator } = require('otplib');
const rateLimit = require('express-rate-limit');

const app = express();
const PORT = process.env.PORT || 3000;

// Trust proxy for correct client IP detection behind Nginx proxy
app.set('trust proxy', 1);

// Database Paths
const oldDbPath = path.join(__dirname, 'db.json');
const usersListPath = path.join(__dirname, 'data', 'users.json');
const userDbsDir = path.join(__dirname, 'data', 'user_dbs');

// Reserved slugs to prevent collisions with global routes and static assets
const RESERVED_SLUGS = [
    'admin', 'login', 'register', 'home', 'account', 'video', 'link', 
    'kichdiem', 'css', 'js', 'lib', 'partials', 'favicon.ico', 'dangky'
];

// Ensure database directories exist
function ensureDirs() {
    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
    }
    if (!fs.existsSync(userDbsDir)) {
        fs.mkdirSync(userDbsDir, { recursive: true });
    }
}
ensureDirs();

// Helper for managing global users list
function readUsersList() {
    try {
        if (!fs.existsSync(usersListPath)) {
            fs.writeFileSync(usersListPath, JSON.stringify([], null, 2), 'utf8');
            return [];
        }
        return JSON.parse(fs.readFileSync(usersListPath, 'utf8'));
    } catch (error) {
        console.error("Error reading users list:", error);
        return [];
    }
}

function writeUsersList(users) {
    try {
        fs.writeFileSync(usersListPath, JSON.stringify(users, null, 2), 'utf8');
    } catch (error) {
        console.error("Error writing users list:", error);
    }
}

function getUserDbPath(slug) {
    return path.join(userDbsDir, `${slug}.json`);
}

function readUserDb(slug) {
    try {
        const userDbPath = getUserDbPath(slug);
        if (!fs.existsSync(userDbPath)) {
            return null;
        }
        const db = JSON.parse(fs.readFileSync(userDbPath, 'utf8'));
        let migrated = false;

        // Ensure proper schema structure
        if (!db.accounts) db.accounts = [];
        if (!db.videos) db.videos = [];
        if (!db.links) db.links = [];
        if (!db.settings) db.settings = {};

        if (db.settings.mailReadMode === undefined) {
            db.settings.mailReadMode = "OAuth2";
            migrated = true;
        }
        if (db.settings.enablePasswordProtection === undefined) {
            db.settings.enablePasswordProtection = false;
            migrated = true;
        }
        if (db.settings.password === undefined) {
            db.settings.password = "123123";
            migrated = true;
        }
        if (db.settings.icloudAccount === undefined) {
            db.settings.icloudAccount = "Tham123@";
            migrated = true;
        }
        if (db.settings.icloudPassword === undefined) {
            db.settings.icloudPassword = "Aa42294sdsa";
            migrated = true;
        }
        if (db.settings.customEmail === undefined) {
            db.settings.customEmail = "default@domain.com";
            migrated = true;
        }
        if (db.settings.customEmailPassword === undefined) {
            db.settings.customEmailPassword = "";
            migrated = true;
        }
        if (db.settings.displaySettings === undefined) {
            db.settings.displaySettings = {
                ShowVideoList: true,
                ShowVideoCustom: true,
                ShowRegularVideo60: true,
                ShowRegularVideo180: true,
                ShowLiteVideo10: true,
                ShowLiteVideo60: true,
                ShowLiteVideo180: true,
                ShowAccountInfo: true,
                ShowRandomEmail: true,
                ShowICloudInfo: true
            };
            migrated = true;
        } else {
            const ds = db.settings.displaySettings;
            if (ds.ShowVideoCustom === undefined) { ds.ShowVideoCustom = true; migrated = true; }
            if (ds.ShowRegularVideo60 === undefined) { ds.ShowRegularVideo60 = true; migrated = true; }
            if (ds.ShowRegularVideo180 === undefined) { ds.ShowRegularVideo180 = true; migrated = true; }
            if (ds.ShowLiteVideo10 === undefined) { ds.ShowLiteVideo10 = true; migrated = true; }
            if (ds.ShowLiteVideo60 === undefined) { ds.ShowLiteVideo60 = true; migrated = true; }
            if (ds.ShowLiteVideo180 === undefined) { ds.ShowLiteVideo180 = true; migrated = true; }
        }
        if (db.settings.displayOrder === undefined) {
            db.settings.displayOrder = ["AccountInfo", "VideoList", "RandomEmail", "ICloudInfo"];
            migrated = true;
        }
        if (db.settings.videoConfigs === undefined) {
            db.settings.videoConfigs = {
                VideoCustom: { title: "Video Custom (Kho)", link: "/Home/GetVideoFromFile" },
                RegularVideo60: { title: "Video Thường 60p", link: "/Home/GetRandomVideo?type=regular" },
                RegularVideo180: { title: "Video Thường 180p", link: "https://www.icloud.com/shortcuts/8e77d69aafde4b41bbb982e21a08265c" },
                LiteVideo10: { title: "Video Lite 10p", link: "/Home/GetRandomVideo10?type=lite" },
                LiteVideo60: { title: "Video Lite 60p", link: "/Home/GetRandomVideo?type=lite" },
                LiteVideo180: { title: "Video Lite 180p", link: "https://www.icloud.com/shortcuts/87bb09da441a49a5b637534658b04578" }
            };
            migrated = true;
        }
        if (migrated) {
            fs.writeFileSync(userDbPath, JSON.stringify(db, null, 2), 'utf8');
        }
        return db;
    } catch (error) {
        console.error(`Error reading database for user ${slug}:`, error);
        return null;
    }
}

function writeUserDb(slug, data) {
    try {
        const userDbPath = getUserDbPath(slug);
        fs.writeFileSync(userDbPath, JSON.stringify(data, null, 2), 'utf8');
    } catch (error) {
        console.error(`Error writing database for user ${slug}:`, error);
    }
}

// Default settings template for new user DBs
const defaultDbTemplate = {
    accounts: [],
    videos: [],
    links: [],
    settings: {
        mailReadMode: "OAuth2",
        enablePasswordProtection: false,
        password: "123123",
        icloudAccount: "",
        icloudPassword: "",
        customEmail: "default@domain.com",
        displaySettings: {
            ShowVideoList: true,
            ShowVideoCustom: true,
            ShowRegularVideo60: true,
            ShowRegularVideo180: true,
            ShowLiteVideo10: true,
            ShowLiteVideo60: true,
            ShowLiteVideo180: true,
            ShowAccountInfo: true,
            ShowRandomEmail: true,
            ShowICloudInfo: true
        },
        displayOrder: ["AccountInfo", "VideoList", "RandomEmail", "ICloudInfo"],
        videoConfigs: {
            VideoCustom: { title: "Video Custom (Kho)", link: "/Home/GetVideoFromFile" },
            RegularVideo60: { title: "Video Thường 60p", link: "/Home/GetRandomVideo?type=regular" },
            RegularVideo180: { title: "Video Thường 180p", link: "https://www.icloud.com/shortcuts/8e77d69aafde4b41bbb982e21a08265c" },
            LiteVideo10: { title: "Video Lite 10p", link: "/Home/GetRandomVideo10?type=lite" },
            LiteVideo60: { title: "Video Lite 60p", link: "/Home/GetRandomVideo?type=lite" },
            LiteVideo180: { title: "Video Lite 180p", link: "https://www.icloud.com/shortcuts/87bb09da441a49a5b637534658b04578" }
        }
    },
    activeAccountId: null,
    kichdiemAccounts: []
};

// Create a new user entry
function createUser(username, password) {
    const slug = username.toLowerCase().trim().replace(/[^a-z0-9_-]/g, '');
    if (!slug) return { status: false, message: 'Tên đường dẫn không hợp lệ. Chỉ sử dụng chữ cái thường, số, dấu gạch ngang (-) và dấu gạch dưới (_).' };
    if (RESERVED_SLUGS.includes(slug)) {
        return { status: false, message: 'Tên đường dẫn này trùng với từ khóa hệ thống!' };
    }

    const users = readUsersList();
    const exists = users.some(u => u.slug === slug);
    if (exists) {
        return { status: false, message: 'Đường dẫn này đã được đăng ký bởi người khác!' };
    }

    // Add user list entry
    users.push({
        username: username.trim(),
        password: password,
        slug: slug,
        createdAt: new Date().toISOString()
    });
    writeUsersList(users);

    // Write default DB configuration
    const userDb = JSON.parse(JSON.stringify(defaultDbTemplate));
    userDb.settings.password = password;
    writeUserDb(slug, userDb);

    return { status: true, slug: slug };
}

// Automatic migration of old db.json
function migrateOldDb() {
    try {
        if (fs.existsSync(oldDbPath)) {
            const oldDb = JSON.parse(fs.readFileSync(oldDbPath, 'utf8'));
            const users = readUsersList();
            const macdinExists = users.some(u => u.slug === 'macdin');
            
            if (!macdinExists) {
                users.push({
                    username: 'macdin',
                    password: (oldDb.settings && oldDb.settings.password) ? oldDb.settings.password : '123123',
                    slug: 'macdin',
                    createdAt: new Date().toISOString()
                });
                writeUsersList(users);
                writeUserDb('macdin', oldDb);
                console.log("Successfully migrated old db.json configuration into user 'macdin'.");
                
                // Rename old db file to back it up and prevent remigration
                const backupPath = path.join(__dirname, 'db_migrated_backup.json');
                fs.renameSync(oldDbPath, backupPath);
            }
        }
    } catch (e) {
        console.error("Migration error:", e);
    }
}
migrateOldDb();

// Helper to parse checkbox inputs
function parseCheckbox(value) {
    if (Array.isArray(value)) {
        return value.includes('true');
    }
    return value === 'true';
}

// App configuration
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Express Session configuration
app.use(session({
    secret: 'kimtool_session_secret_key_123456',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 } // 24 hours
}));

// Rate Limit configurations
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: 60, // Limit each IP to 60 requests per minute
    message: 'Quá nhiều yêu cầu từ địa chỉ IP này. Vui lòng thử lại sau 1 phút!',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

const authLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    limit: 5, // Limit each IP to 5 auth-related requests per minute
    message: 'Bạn đã thực hiện quá nhiều yêu cầu đăng ký hoặc đăng nhập. Vui lòng đợi 1 phút trước khi thử lại!',
    standardHeaders: 'draft-7',
    legacyHeaders: false,
});

app.use(globalLimiter);

// Default global local variables
app.use((req, res, next) => {
    res.locals.authenticated = false;
    res.locals.settings = {};
    res.locals.slug = null;
    next();
});

// ---------------- GLOBAL CONTROLLERS ----------------

// Global Landing & Self-Registration Page
app.get('/', (req, res) => {
    res.render('landing', { error: req.query.error || null, success: req.query.success || null });
});

// Self-Registration handler
app.post('/register', authLimiter, (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.redirect('/?error=Vui lòng điền đầy đủ tên đường dẫn và mật khẩu!');
    }
    
    const result = createUser(username, password);
    if (result.status) {
        // Auto authenticate session for the newly registered slug
        if (!req.session.authenticatedSlugs) req.session.authenticatedSlugs = {};
        req.session.authenticatedSlugs[result.slug] = true;
        return res.redirect(`/${result.slug}`);
    } else {
        return res.redirect(`/?error=${encodeURIComponent(result.message)}`);
    }
});

// Master Admin Panel Protection
const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';

app.get('/admin', (req, res) => {
    const isAuth = !!req.session.adminAuthenticated;
    if (isAuth) {
        const users = readUsersList();
        res.render('admin', { users: users, authenticated: true, error: req.query.error || null, success: req.query.success || null });
    } else {
        res.render('admin', { authenticated: false, error: req.query.error || null });
    }
});

app.post('/admin/login', authLimiter, (req, res) => {
    const { password } = req.body;
    if (password === adminPassword) {
        req.session.adminAuthenticated = true;
        res.redirect('/admin');
    } else {
        res.redirect('/admin?error=Sai mật khẩu quản trị!');
    }
});

app.post('/admin/logout', (req, res) => {
    req.session.adminAuthenticated = false;
    res.redirect('/admin');
});

app.post('/admin/add-user', (req, res) => {
    if (!req.session.adminAuthenticated) {
        return res.status(401).send('Unauthorized');
    }
    const { username, password } = req.body;
    if (!username || !password) {
        return res.redirect('/admin?error=Vui lòng điền đầy đủ thông tin!');
    }
    const result = createUser(username, password);
    if (result.status) {
        res.redirect('/admin?success=Đã tạo link thành công!');
    } else {
        res.redirect(`/admin?error=${encodeURIComponent(result.message)}`);
    }
});

app.post('/admin/delete-user', (req, res) => {
    if (!req.session.adminAuthenticated) {
        return res.status(401).send('Unauthorized');
    }
    const { slug } = req.body;
    if (!slug) {
        return res.redirect('/admin?error=Thiếu thông tin!');
    }
    
    let users = readUsersList();
    users = users.filter(u => u.slug !== slug);
    writeUsersList(users);
    
    // Cleanup DB file
    const userDbPath = getUserDbPath(slug);
    if (fs.existsSync(userDbPath)) {
        try {
            fs.unlinkSync(userDbPath);
        } catch (e) {
            console.error(`Error deleting db file for user ${slug}:`, e);
        }
    }
    
    res.redirect('/admin?success=Đã xóa đường dẫn thành công!');
});


// ---------------- USER-SPECIFIC ROUTER ----------------
// Note: This must be mounted AFTER the global static assets and controllers 
// to prevent matching reserved system slugs.
const userRouter = express.Router({ mergeParams: true });

// Load user-specific configurations for all user routes
userRouter.use((req, res, next) => {
    const { slug } = req.params;
    
    // Ignore reserved slugs explicitly if any static requests leak through
    if (RESERVED_SLUGS.includes(slug.toLowerCase())) {
        return next('router');
    }
    
    const db = readUserDb(slug);
    if (!db) {
        return res.status(404).send('Không tìm thấy đường dẫn này trong hệ thống. Vui lòng kiểm tra lại!');
    }
    req.userDb = db;
    req.userSlug = slug;
    
    // Bind variables to locals for use in templates automatically
    res.locals.slug = slug;
    res.locals.settings = db.settings;
    res.locals.authenticated = !!(req.session.authenticatedSlugs && req.session.authenticatedSlugs[slug]);
    
    next();
});const checkUserAuth = (req, res, next) => {
    const db = req.userDb;
    const slug = req.userSlug;
    if (!db || !db.settings) {
        return res.status(404).send('Không tìm thấy đường dẫn này trong hệ thống. Vui lòng kiểm tra lại!');
    }
    if (db.settings.enablePasswordProtection) {
        const isAuth = req.session.authenticatedSlugs && req.session.authenticatedSlugs[slug];
        if (isAuth) {
            return next();
        } else {
            return res.redirect(`/${slug}/Login`);
        }
    }
    return next();
};

// 1. LOGIN & LOGOUT ROUTES PER SLUG
userRouter.get('/Login', (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    
    if (!db.settings.enablePasswordProtection) {
        if (!req.session.authenticatedSlugs) req.session.authenticatedSlugs = {};
        req.session.authenticatedSlugs[slug] = true;
        return res.redirect(`/${slug}`);
    }
    
    const isAuth = req.session.authenticatedSlugs && req.session.authenticatedSlugs[slug];
    if (isAuth) {
        return res.redirect(`/${slug}`);
    }
    
    res.render('login', { error: req.query.error || null, slug: slug });
});

userRouter.post('/Login', authLimiter, (req, res) => {
    const { password } = req.body;
    const db = req.userDb;
    const slug = req.userSlug;
    
    if (password === db.settings.password) {
        if (!req.session.authenticatedSlugs) req.session.authenticatedSlugs = {};
        req.session.authenticatedSlugs[slug] = true;
        return res.redirect(`/${slug}`);
    } else {
        return res.redirect(`/${slug}/Login?error=Sai mật khẩu bảo vệ!`);
    }
});

userRouter.post('/Login/Logout', (req, res) => {
    const slug = req.userSlug;
    if (req.session.authenticatedSlugs) {
        delete req.session.authenticatedSlugs[slug];
    }
    res.redirect(`/${slug}/Login`);
});

// 2. USER DASHBOARD
userRouter.get('/', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    
    let activeAccount = null;
    if (db.activeAccountId) {
        activeAccount = db.accounts.find(a => a.id === db.activeAccountId);
    }
    
    const randomEmail = db.settings.customEmail || '';
    
    res.render('index', {
        settings: db.settings,
        activeAccount: activeAccount,
        randomEmail: randomEmail,
        slug: slug
    });
});

// 3. SETTINGS & SAVE
userRouter.get('/Settings', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    res.render('settings', {
        settings: db.settings,
        successMsg: req.query.success || null,
        errorMsg: req.query.error || null,
        slug: slug
    });
});

userRouter.post('/Settings/Save', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    
    // Save Mail Settings
    const { MailReadMode } = req.body;
    if (MailReadMode) {
        db.settings.mailReadMode = MailReadMode;
    }
    
    // Save Password Settings
    const { EnablePasswordProtection, Password } = req.body;
    db.settings.enablePasswordProtection = parseCheckbox(EnablePasswordProtection);
    if (Password && Password.trim() !== '') {
        db.settings.password = Password.trim();
    }
    
    // Save iCloud Settings
    let { account, password } = req.body;
    if (!account) account = '';
    account = account.trim();
    if (!password) password = '';
    password = password.trim();
    db.settings.icloudAccount = account;
    db.settings.icloudPassword = password;
    
    // Save Email Settings
    let { email, emailPassword } = req.body;
    if (!email) email = '';
    email = email.trim();
    if (email.length >= 50) {
        return res.redirect(`/${slug}/Settings?error=Email không được dài từ 50 ký tự trở lên!`);
    }
    if (!emailPassword) emailPassword = '';
    emailPassword = emailPassword.trim();
    db.settings.customEmail = email;
    db.settings.customEmailPassword = emailPassword;
    
    // Save Display Settings
    db.settings.displaySettings.ShowVideoList = parseCheckbox(req.body.ShowVideoList);
    db.settings.displaySettings.ShowVideoCustom = parseCheckbox(req.body.ShowVideoCustom);
    db.settings.displaySettings.ShowRegularVideo60 = parseCheckbox(req.body.ShowRegularVideo60);
    db.settings.displaySettings.ShowRegularVideo180 = parseCheckbox(req.body.ShowRegularVideo180);
    db.settings.displaySettings.ShowLiteVideo10 = parseCheckbox(req.body.ShowLiteVideo10);
    db.settings.displaySettings.ShowLiteVideo60 = parseCheckbox(req.body.ShowLiteVideo60);
    db.settings.displaySettings.ShowLiteVideo180 = parseCheckbox(req.body.ShowLiteVideo180);
    db.settings.displaySettings.ShowAccountInfo = parseCheckbox(req.body.ShowAccountInfo);
    db.settings.displaySettings.ShowRandomEmail = parseCheckbox(req.body.ShowRandomEmail);
    db.settings.displaySettings.ShowICloudInfo = parseCheckbox(req.body.ShowICloudInfo);
    
    // Sortable order list
    const orders = [
        { name: 'VideoList', val: parseInt(req.body.VideoListOrder) || 1 },
        { name: 'AccountInfo', val: parseInt(req.body.AccountInfoOrder) || 2 },
        { name: 'RandomEmail', val: parseInt(req.body.RandomEmailOrder) || 3 },
        { name: 'ICloudInfo', val: parseInt(req.body.ICloudInfoOrder) || 4 }
    ];
    orders.sort((a, b) => a.val - b.val);
    db.settings.displayOrder = orders.map(o => o.name);
    
    // Save video titles and links
    db.settings.videoConfigs = {
        VideoCustom: {
            title: (req.body.VideoCustomTitle || '').trim() || "Video Custom (Kho)",
            link: (req.body.VideoCustomLink || '').trim() || "/Home/GetVideoFromFile"
        },
        RegularVideo60: {
            title: (req.body.RegularVideo60Title || '').trim() || "Video Thường 60p",
            link: (req.body.RegularVideo60Link || '').trim() || "/Home/GetRandomVideo?type=regular"
        },
        RegularVideo180: {
            title: (req.body.RegularVideo180Title || '').trim() || "Video Thường 180p",
            link: (req.body.RegularVideo180Link || '').trim() || "https://www.icloud.com/shortcuts/8e77d69aafde4b41bbb982e21a08265c"
        },
        LiteVideo10: {
            title: (req.body.LiteVideo10Title || '').trim() || "Video Lite 10p",
            link: (req.body.LiteVideo10Link || '').trim() || "/Home/GetRandomVideo10?type=lite"
        },
        LiteVideo60: {
            title: (req.body.LiteVideo60Title || '').trim() || "Video Lite 60p",
            link: (req.body.LiteVideo60Link || '').trim() || "/Home/GetRandomVideo?type=lite"
        },
        LiteVideo180: {
            title: (req.body.LiteVideo180Title || '').trim() || "Video Lite 180p",
            link: (req.body.LiteVideo180Link || '').trim() || "https://www.icloud.com/shortcuts/87bb09da441a49a5b637534658b04578"
        }
    };
    
    writeUserDb(slug, db);
    res.redirect(`/${slug}/Settings?success=Đã lưu tất cả cấu hình hệ thống!`);
});

// 4. ADD DATA QUICK ACTION ROUTES
// Add Account
userRouter.get('/Account/AddAccount', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    const accountsText = db.accounts.map(a => {
        let line = `${a.email}|${a.emailPass || ''}|${a.username || ''}`;
        line += `|${a.password || ''}`;
        line += `|${a.secret || ''}`;
        if (a.refreshToken || a.clientId) {
            line += `|${a.refreshToken || ''}|${a.clientId || ''}`;
        }
        return line.replace(/\|+$/, '');
    }).join('\n');
    
    res.render('add_account', { accountsText, slug: slug });
});

userRouter.post('/Account/SaveAccounts', checkUserAuth, (req, res) => {
    const { accounts } = req.body;
    const db = req.userDb;
    const slug = req.userSlug;
    
    const lines = (accounts || '').split('\n');
    const newAccounts = [];
    let idCounter = 1;
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        const parts = line.split('|').map(p => p.trim());
        newAccounts.push({
            id: idCounter++,
            email: parts[0] || '',
            emailPass: parts[1] || '',
            username: parts[2] || '',
            password: parts[3] || '',
            secret: parts[4] || '',
            refreshToken: parts[5] || '',
            clientId: parts[6] || '',
            fetched: false
        });
    }
    
    db.accounts = newAccounts;
    db.activeAccountId = null;
    writeUserDb(slug, db);
    res.json({ status: true, message: 'Đã tự động lưu tài khoản thành công!' });
});

// Add Video
userRouter.get('/Video/AddVideo', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    res.render('add_video', { 
        videos: db.videos,
        successMsg: req.query.success || null,
        errorMsg: req.query.error || null,
        slug: slug
    });
});

userRouter.post('/Video/SaveVideos', checkUserAuth, (req, res) => {
    let urls = req.body.urls || [];
    let notes = req.body.notes || [];
    
    if (!Array.isArray(urls)) urls = [urls];
    if (!Array.isArray(notes)) notes = [notes];
    
    const db = req.userDb;
    const slug = req.userSlug;
    const newVideos = [];
    let idCounter = 1;
    
    for (let i = 0; i < urls.length; i++) {
        const url = (urls[i] || '').trim();
        if (url !== '') {
            newVideos.push({
                id: idCounter++,
                url: url,
                note: (notes[i] || '').trim()
            });
        }
    }
    
    db.videos = newVideos;
    writeUserDb(slug, db);
    res.json({ status: true, message: 'Đã tự động lưu video thành công!' });
});

// Add Link
userRouter.get('/Link/AddLink', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    res.render('add_link', { 
        links: db.links,
        successMsg: req.query.success || null,
        errorMsg: req.query.error || null,
        slug: slug
    });
});

userRouter.post('/Link/SaveLink', checkUserAuth, (req, res) => {
    let urls = req.body.urls || [];
    let notes = req.body.notes || [];
    
    if (!Array.isArray(urls)) urls = [urls];
    if (!Array.isArray(notes)) notes = [notes];
    
    const db = req.userDb;
    const slug = req.userSlug;
    const newLinks = [];
    let idCounter = 1;
    
    for (let i = 0; i < urls.length; i++) {
        const url = (urls[i] || '').trim();
        if (url !== '') {
            newLinks.push({
                id: idCounter++,
                url: url,
                note: (notes[i] || '').trim()
            });
        }
    }
    
    db.links = newLinks;
    writeUserDb(slug, db);
    res.json({ status: true, message: 'Đã tự động lưu liên kết thành công!' });
});

// 5. ACCOUNT / OPT ACTION ENDPOINTS
userRouter.get('/Home/GetAccount', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    
    if (db.accounts.length === 0) {
        return res.redirect(`/${slug}?error=Chưa có tài khoản nào trong hệ thống!`);
    }
    
    let nextAcc = db.accounts.find(a => !a.fetched);
    if (!nextAcc) {
        db.accounts.forEach(a => a.fetched = false);
        nextAcc = db.accounts[0];
    }
    
    nextAcc.fetched = true;
    db.activeAccountId = nextAcc.id;
    writeUserDb(slug, db);
    res.redirect(`/${slug}`);
});

userRouter.get('/Home/GetOtp', checkUserAuth, (req, res) => {
    const { secret } = req.query;
    if (!secret || secret.trim() === '') {
        return res.json({ status: false, message: 'Thiếu secret key' });
    }
    try {
        const otp = authenticator.generate(secret.trim().replace(/\s/g, ''));
        const remaining = 30 - (Math.floor(Date.now() / 1000) % 30);
        res.json({ status: true, otp: otp, remaining: remaining });
    } catch (error) {
        console.error("Error generating TOTP:", error);
        res.json({ status: false, message: 'Lỗi giải mã secret key hoặc định dạng không đúng' });
    }
});

userRouter.post('/Home/AnalyzeAccountData', checkUserAuth, (req, res) => {
    const arr = req.body;
    if (!arr || !Array.isArray(arr) || arr.length === 0) {
        return res.json({ status: false, message: 'Dữ liệu không hợp lệ.' });
    }
    const db = req.userDb;
    const activeAccount = db.accounts.find(a => a.id === db.activeAccountId);
    
    if (activeAccount) {
        res.json({
            email: activeAccount.email,
            password: activeAccount.emailPass,
            refreshToken: activeAccount.refreshToken || '',
            clientId: activeAccount.clientId || ''
        });
    } else {
        res.json({
            email: arr[0] || '',
            password: arr[1] || '',
            refreshToken: arr[5] || '',
            clientId: arr[6] || ''
        });
    }
});

userRouter.post('/Home/GetCode', checkUserAuth, async (req, res) => {
    const { email, password, refreshToken, clientId } = req.body;
    const db = req.userDb;
    const mode = (db.settings.mailReadMode || '').toLowerCase();
    
    if (!email) {
        return res.json({ status: false, message: 'Thiếu thông tin Email.' });
    }
    
    if (mode === 'fakeemail' || email.includes('emailfake')) {
        const parts = email.split('@');
        const username = parts[0] || '';
        const domain = parts[1] || 'emailfake.com';
        const fakeEmailUrl = `https://emailfake.com/${domain}/${username}`;
        return res.json({
            status: true,
            code: fakeEmailUrl,
            content: `Hộp thư FakeEmail cho: ${email}`
        });
    }
    
    if ((mode === 'oauth2' || mode === 'oauth2server2' || mode === 'graph') && refreshToken && clientId) {
        try {
            const tokenUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
            const tokenParams = new URLSearchParams({
                client_id: clientId,
                grant_type: 'refresh_token',
                refresh_token: refreshToken,
                scope: 'https://graph.microsoft.com/Mail.Read'
            });
            
            const tokenRes = await fetch(tokenUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: tokenParams
            });
            
            if (!tokenRes.ok) {
                const errText = await tokenRes.text();
                return res.json({ status: false, message: `Lỗi kết nối OAuth2 Microsoft: ${errText}` });
            }
            
            const tokenData = await tokenRes.json();
            const accessToken = tokenData.access_token;
            if (!accessToken) {
                return res.json({ status: false, message: 'Không thể cấp mới access token.' });
            }
            
            const messagesUrl = `https://graph.microsoft.com/v1.0/users/${email}/messages?$top=10&$select=subject,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc`;
            let msgRes = await fetch(messagesUrl, {
                headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            
            if (!msgRes.ok) {
                const meUrl = `https://graph.microsoft.com/v1.0/me/messages?$top=10&$select=subject,bodyPreview,receivedDateTime&$orderby=receivedDateTime desc`;
                const meRes = await fetch(meUrl, {
                    headers: { 'Authorization': `Bearer ${accessToken}` }
                });
                if (meRes.ok) {
                    msgRes = meRes;
                } else {
                    const errText = await msgRes.text();
                    return res.json({ status: false, message: `Lỗi đọc hòm thư Microsoft Graph: ${errText}` });
                }
            }
            
            const msgData = await msgRes.json();
            const messages = msgData.value || [];
            let otpCode = null;
            let emailContent = '';
            
            for (const msg of messages) {
                const subject = msg.subject || '';
                const preview = msg.bodyPreview || '';
                const match = subject.match(/\d{4,8}/) || preview.match(/\d{4,8}/);
                if (match) {
                    otpCode = match[0];
                    emailContent = `[Tiêu đề: ${msg.subject}] - Nội dung: ${preview}`;
                    break;
                }
            }
            
            if (otpCode) {
                return res.json({ status: true, code: otpCode, content: emailContent });
            } else {
                return res.json({ status: false, message: 'Không tìm thấy mail chứa mã code xác minh mới (4-8 chữ số).' });
            }
        } catch (error) {
            console.error('OAuth2 Mail Read Error:', error);
            return res.json({ status: false, message: `Lỗi hệ thống đọc mail Microsoft: ${error.message}` });
        }
    }
    
    // Fallback simulation
    const randomCode = Math.floor(100000 + Math.random() * 900000).toString();
    const mockEmailTemplates = [
        {
            code: randomCode,
            content: `Mã bảo mật của tài khoản Microsoft của bạn là: ${randomCode}. Nếu bạn không yêu cầu mã này, vui lòng bỏ qua.`
        },
        {
            code: randomCode,
            content: `Your iCloud verification code is: ${randomCode}. Enter this code to verify your Apple ID login.`
        },
        {
            code: randomCode,
            content: `Dịch vụ xác thực: Mã OTP đăng nhập của bạn là ${randomCode}, có hiệu lực trong vòng 5 phút.`
        }
    ];
    
    let template = mockEmailTemplates[2];
    if (email.includes('edudc') || email.includes('outlook') || email.includes('hotmail')) {
        template = mockEmailTemplates[0];
    } else if (email.includes('icloud') || email.includes('apple')) {
        template = mockEmailTemplates[1];
    }
    
    setTimeout(() => {
        res.json({ status: true, code: template.code, content: template.content });
    }, 1200);
});

userRouter.get('/Home/GetVideoFromFile', checkUserAuth, (req, res) => {
    res.redirect('https://vt.tiktok.com/ZSUwetdS7/');
});

userRouter.get('/Home/GetRandomVideo', checkUserAuth, (req, res) => {
    const { type } = req.query;
    if (type === 'lite') {
        res.redirect('https://vt.tiktok.com/ZSUwebqJX/');
    } else {
        res.redirect('https://vt.tiktok.com/ZSUwetdS7/');
    }
});

userRouter.get('/Home/GetRandomVideo10', checkUserAuth, (req, res) => {
    res.redirect('https://vt.tiktok.com/ZSUwebqJX/');
});

// 6. KÍCH ĐIỂM ROUTES PER SLUG
userRouter.get('/Kichdiem', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    const kichdiemAccounts = db.kichdiemAccounts || [];
    const accountsText = kichdiemAccounts.map(a => {
        let line = `${a.email}|${a.emailPass || ''}|${a.username || ''}`;
        if (a.password) line += `|${a.password}`;
        return line;
    }).join('\n');
    res.render('kichdiem', { accountsText, slug: slug });
});

userRouter.post('/Kichdiem/SaveAccounts', checkUserAuth, (req, res) => {
    const { accounts } = req.body;
    const db = req.userDb;
    const slug = req.userSlug;
    
    const lines = (accounts || '').split('\n');
    const newAccounts = [];
    let idCounter = 1;
    
    for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        
        const parts = line.split('|').map(p => p.trim());
        newAccounts.push({
            id: idCounter++,
            email: parts[0] || '',
            emailPass: parts[1] || '',
            username: parts[2] || '',
            password: parts[3] || '',
            fetched: false
        });
    }
    
    db.kichdiemAccounts = newAccounts;
    writeUserDb(slug, db);
    res.json({ status: true, message: 'Đã tự động lưu tài khoản kích điểm thành công!' });
});

userRouter.post('/Home/KichDiem', checkUserAuth, (req, res) => {
    const db = req.userDb;
    const slug = req.userSlug;
    
    const activeAccount = db.accounts.find(a => a.id === db.activeAccountId);
    if (!activeAccount) {
        return res.json({ status: false, message: 'Không tìm thấy tài khoản hoạt động nào để lưu!' });
    }
    
    if (!db.kichdiemAccounts) {
        db.kichdiemAccounts = [];
    }
    
    const exists = db.kichdiemAccounts.some(a => 
        a.email === activeAccount.email && 
        a.username === activeAccount.username
    );
    
    if (!exists) {
        const nextId = db.kichdiemAccounts.length > 0 
            ? Math.max(...db.kichdiemAccounts.map(a => a.id)) + 1 
            : 1;
        
        db.kichdiemAccounts.push({
            id: nextId,
            email: activeAccount.email || '',
            emailPass: activeAccount.emailPass || '',
            username: activeAccount.username || '',
            password: activeAccount.password || '',
            fetched: false
        });
        writeUserDb(slug, db);
    }
    
    res.json({ status: true, message: 'Lưu thông tin tài khoản vào mục Kích Điểm thành công!' });
});

// Register User Router at the very end to prevent intercepting system-level routes
app.use('/:slug', userRouter);

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
