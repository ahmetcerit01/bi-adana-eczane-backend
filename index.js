require('dotenv').config();
const axios = require('axios');
const admin = require('firebase-admin');
const cron = require('node-cron');
const nodemailer = require('nodemailer');

// --- 1. FIREBASE SETUP ---
try {
    const serviceAccount = require('./serviceAccountKey.json');
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase initialized successfully.");
} catch (error) {
    console.error("❌ CRITICAL ERROR: 'serviceAccountKey.json' not found!");
    process.exit(1);
}

const db = admin.firestore();

// --- 2. CONFIGURATION ---
const CITY = 'Adana';
const DISTRICTS = [
    'Seyhan', 'Yüreğir', 'Çukurova', 'Sarıçam', 'Ceyhan', 
    'Kozan', 'İmamoğlu', 'Karataş', 'Karaisalı', 'Pozantı', 
    'Yumurtalık', 'Tufanbeyli', 'Feke', 'Aladağ', 'Saimbeyli'
];

// --- 3. MAIL CONFIGURATION ---
// Gmail kullanıyorsan "Uygulama Şifresi" oluşturman gerekir.
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: process.env.EMAIL_USER, // .env dosyasına ekle
        pass: process.env.EMAIL_PASS  // .env dosyasına ekle (Uygulama şifresi)
    }
});

// --- 4. FUNCTIONS ---

function normalizeName(name) {
    return name.toLowerCase()
        .replace(/ eczanesi/gi, '')
        .replace(/ ecz\./gi, '')
        .replace(/ ecz/gi, '')
        .trim();
}

async function sendSummaryEmail(updatedList, errorList) {
    const dateStr = new Date().toLocaleDateString('tr-TR');
    
    const successHtml = updatedList.length > 0 
        ? updatedList.map(p => `<li><b>${p.district}:</b> ${p.name}</li>`).join('')
        : "<li>⚠️ Hiçbir eczane güncellenemedi!</li>";
        
    const errorHtml = errorList.length > 0
        ? `<h3 style="color: red;">Hatalar / Bulunamayanlar:</h3><ul>` + 
          errorList.map(e => `<li><b>${e.district}:</b> ${e.name}</li>`).join('') + `</ul>`
        : "";

    const mailOptions = {
        from: `"Bi'Adana Otomasyon" <${process.env.EMAIL_USER}>`,
        to: process.env.EMAIL_USER,
        subject: `💊 Nöbetçi Eczane Raporu - ${dateStr}`,
        html: `
            <div style="font-family: sans-serif; padding: 20px; border: 1px solid #eee;">
                <h2>Günaydın Ahmet! 🌯</h2>
                <p><b>${dateStr}</b> tarihi için nöbetçi eczane güncelleme işlemi tamamlandı.</p>
                <hr/>
                <h3 style="color: green;">Güncellenen Eczaneler:</h3>
                <ul>${successHtml}</ul>
                ${errorHtml}
                <p style="margin-top: 20px; font-size: 12px; color: #777;">Bu rapor Bi'Adana backend sistemi tarafından otomatik oluşturulmuştur.</p>
            </div>
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log("📧 Özet maili gönderildi.");
    } catch (error) {
        console.error("❌ Mail hatası:", error.message);
    }
}

async function resetDutyStatuses() {
    console.log("🧹 Resetting current duty statuses...");
    const dutySnapshot = await db.collection('places')
        .where('categoryId', '==', 'eczane')
        .where('isOnDuty', '==', true)
        .get();

    if (dutySnapshot.empty) return;

    const batch = db.batch();
    dutySnapshot.forEach(doc => {
        batch.update(doc.ref, { isOnDuty: false });
    });
    await batch.commit();
    console.log(`✅ Successfully reset ${dutySnapshot.size} pharmacies.`);
}

async function syncDutyPharmacies() {
    await resetDutyStatuses();
    const updatedList = [];
    const errorList = [];
    
    console.log(`🚀 Starting sync job...`);

    for (const district of DISTRICTS) {
        try {
            const options = {
                method: 'GET',
                url: 'https://nobetci-eczane-api-turkiye.p.rapidapi.com/pharmacies-on-duty',
                params: { district, city: CITY },
                headers: {
                    'X-RapidAPI-Key': process.env.RAPID_API_KEY,
                    'X-RapidAPI-Host': 'nobetci-eczane-api-turkiye.p.rapidapi.com'
                }
            };

            const response = await axios.request(options);
            const apiList = response.data.data || response.data.result || [];

            for (const pharmacy of apiList) {
                const searchName = normalizeName(pharmacy.pharmacyName);
                const placeQuery = await db.collection('places')
                    .where('categoryId', '==', 'eczane')
                    .where('name', '>=', pharmacy.pharmacyName.split(' ')[0])
                    .get();

                if (!placeQuery.empty) {
                    const bestMatch = placeQuery.docs.find(doc => {
                        const dbName = doc.data().name.toLowerCase();
                        const dbDistrict = doc.data().district.toLowerCase();
                        return dbName.includes(searchName) && dbDistrict.includes(district.toLowerCase().replace('ü','u').replace('ç','c'));
                    }) || placeQuery.docs[0];

                    await bestMatch.ref.update({
                        isOnDuty: true,
                        updatedAt: admin.firestore.FieldValue.serverTimestamp()
                    });
                    console.log(`✨ SET ON DUTY: ${bestMatch.data().name} (${district})`);
                    updatedList.push({ district, name: bestMatch.data().name });
                } else {
                    console.warn(`⚠️ Not found: ${pharmacy.pharmacyName}`);
                    errorList.push({ district, name: pharmacy.pharmacyName });
                }
            }
        } catch (error) {
            console.error(`❌ API Error for ${district}:`, error.message);
        }
        await new Promise(resolve => setTimeout(resolve, 1200));
    }
    
    await sendSummaryEmail(updatedList, errorList);
    console.log("🏁 Daily sync completed.");
}

// --- 5. SCHEDULER ---
cron.schedule('30 08 * * *', () => {
    syncDutyPharmacies();
});

console.log("⏳ Background worker active. Waiting for 08:30 AM scheduler...");
syncDutyPharmacies();