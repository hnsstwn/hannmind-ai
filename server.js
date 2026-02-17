/**
 * HANNMIND AI - PRODUCTION BACKEND SERVER
 * ---------------------------------------
 * Stack: Node.js, Express, Google Generative AI
 * Security: Helmet, Rate Limit, CORS, Input Validation
 */

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const dotenv = require('dotenv');
const { GoogleGenerativeAI } = require('@google/generative-ai');

// 1. Configuration Setup
dotenv.config();

const app = express();
const PORT = process.env.PORT || 5000;

// Initialize AI SDK
// Pastikan GEMINI_API_KEY ada di .env
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// 2. Security & Utility Middleware

// Helmet untuk mengamankan HTTP headers
app.use(helmet());

// Logging request untuk monitoring (format 'combined' standar Apache)
app.use(morgan('combined'));

// Konfigurasi CORS (Cross-Origin Resource Sharing)
// Hanya mengizinkan request dari domain yang terdaftar (Localhost & Production)
const allowedOrigins = [
  'http://localhost:3000', // Frontend Local React default
  'http://localhost:5173', // Frontend Local Vite default
  process.env.FRONTEND_URL // Domain Production (set di .env)
];

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Parsing JSON body dengan limit 1MB untuk mencegah DoS via payload besar
app.use(express.json({ limit: '1mb' }));

// Rate Limiting: Mencegah brute-force/spam
// Maksimal 30 request per 1 menit per IP
const limiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 menit
  max: 30, 
  message: { error: "Too many requests, please try again later." },
  standardHeaders: true,
  legacyHeaders: false,
});

// Terapkan rate limit hanya ke endpoint chat
app.use('/api/chat', limiter);


// 3. Helper Functions

// Fungsi Validasi Input
const validateInput = (body) => {
  const { message, mode } = body;
  
  // Cek message
  if (!message || typeof message !== 'string') {
    return "Message is required and must be a string.";
  }
  if (message.length > 2000) {
    return "Message exceeds the maximum limit of 2000 characters.";
  }

  // Cek Mode (Whitelist)
  const allowedModes = ['assistant', 'coding', 'creative', 'quick'];
  if (mode && !allowedModes.includes(mode)) {
    return `Invalid mode. Allowed: ${allowedModes.join(', ')}`;
  }

  return null; // Tidak ada error
};

// System Prompt berdasarkan Mode
const getSystemInstruction = (mode) => {
  const basePrompt = "You are HannMind v3.3, an advanced AI system. Respond in a mix of Indonesian and tech-savvy English terms.";
  switch (mode) {
    case 'coding': return basePrompt + " Focus on clean, efficient code. Explain logic briefly.";
    case 'creative': return basePrompt + " Be imaginative, descriptive, and visionary.";
    case 'quick': return basePrompt + " Be extremely concise and direct. No filler words.";
    default: return basePrompt + " Be helpful and polite.";
  }
};

// 4. API Endpoints

// Health Check Endpoint (Untuk monitoring uptime layanan)
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime() 
  });
});

// Main Chat Endpoint
app.post('/api/chat', async (req, res, next) => {
  try {
    // A. Validasi
    const validationError = validateInput(req.body);
    if (validationError) {
      return res.status(400).json({ error: validationError });
    }

    const { message, image, mode, history } = req.body;

    // B. Setup Model AI
    const model = genAI.getGenerativeModel({ 
      model: "gemini-1.5-flash", // Model cepat dan hemat biaya
      systemInstruction: getSystemInstruction(mode || 'assistant')
    });

    // C. Persiapan Prompt & Gambar
    let promptParts = [message];
    
    // Jika ada gambar (Base64), konversi ke format Gemini
    if (image) {
      try {
        // Hapus prefix "data:image/png;base64," jika ada
        const base64Data = image.includes('base64,') ? image.split('base64,')[1] : image;
        const mimeType = image.includes(';') ? image.split(';')[0].split(':')[1] : 'image/jpeg';
        
        promptParts.push({
          inlineData: {
            data: base64Data,
            mimeType: mimeType
          }
        });
      } catch (imgErr) {
        console.error("Image processing error:", imgErr);
        return res.status(400).json({ error: "Invalid image format." });
      }
    }

    // D. Generate Content (Streaming off for simplicity in basic fetch)
    // Note: History chat bisa diimplementasikan dengan chatSession, 
    // tapi untuk stateless request kita kirim konteks via prompt atau structure history.
    // Di sini kita pakai single turn generation untuk simplifikasi state.
    
    const result = await model.generateContent(promptParts);
    const response = await result.response;
    const text = response.text();

    // E. Kirim Response Aman
    res.json({ reply: text });

  } catch (error) {
    next(error); // Lempar ke global error handler
  }
});

// 5. Global Error Handler Middleware
// Menangkap semua error async/sync agar server tidak crash
app.use((err, req, res, next) => {
  console.error(`[SERVER ERROR] ${err.message}`);
  // Jangan pernah kirim stack trace ke client di production
  res.status(500).json({ 
    error: "Internal Server Error. Our neural core encountered an unexpected issue." 
  });
});

// 6. Start Server
app.listen(PORT, () => {
  console.log(`
  🚀 HANNMIND NEURAL CORE ONLINE
  ------------------------------
  ► Environment : ${process.env.NODE_ENV || 'development'}
  ► Port        : ${PORT}
  ► Rate Limit  : 30 req/min
  `);
});
