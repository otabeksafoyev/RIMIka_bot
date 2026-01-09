const TelegramBot = require('node-telegram-bot-api');
const { MongoClient } = require('mongodb');
const express = require('express');
const { v4: uuidv4 } = require('uuid');

// ======================
// ⚙️ SOZLAMALAR
// ======================
const TOKEN = "8259775501:AAE8xgn5b1ryPnZ7MFXNMFQE_GmUQlEtRGU";
const MONGO_URL = "mongodb+srv://safootabekyev_db_user:kKjW0vqmvhPbPzk6@cluster0.pniaa23.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0";
const UPLOAD_CHANNEL = "Sakuramibacent";
const SUB_CHANNEL = "SakuramiTG";        // Bu kanalga ham treyler yuboriladi
const NEWS_CHANNEL = "SakuramiTG";
const PAYMENT_CHECK_CHANNEL = "pullarnitekshirish"; // Yangi kanal: @pullarnitekshirish
const ADMIN_IDS = [8173188671];
const ADMIN_USERNAME = "safoyev9225";
const BOT_VERSION = "2.3.0";

// Bot
const bot = new TelegramBot(TOKEN, { polling: false });
let BOT_USERNAME = '';

// MongoDB
let client;
let db;
let serials;
let episodes;
let users;
let settings;
let banned_users;
let premiums; // Yangi kolleksiya: premium foydalanuvchilar
let temp_payments; // Temp uchun: tanlangan oylar

// ======================
// Badge rasmlari
// ======================
const BADGE_URLS = {
    beginner: "https://i.postimg.cc/sXRMQc4H/photo-2026-01-05-15-27-04.jpg",
    otaku: "https://i.postimg.cc/PrN5q9k8/photo-2026-01-05-15-23-18.jpg",
    senpai: "https://i.postimg.cc/63YBWLjB/photo-2026-01-05-15-23-41.jpg",
    hokage: "https://i.postimg.cc/qMtprK8X/photo-2026-01-05-15-23-07.jpg"
};

// ======================
// MongoDB ulanish
// ======================
async function connectToMongo() {
    try {
        client = await MongoClient.connect(MONGO_URL);
        console.log("✅ MongoDB ga muvaffaqiyatli ulanildi!");
        db = client.db("anime_bot");
        serials = db.collection("serials");
        episodes = db.collection("episodes");
        users = db.collection("users");
        settings = db.collection("settings");
        banned_users = db.collection("banned_users");
        premiums = db.collection("premiums"); // Yangi kolleksiya
        temp_payments = db.collection("temp_payments"); // Temp oylar uchun
    } catch (err) {
        console.error("❌ MongoDB ulanishda xato:", err.message);
        process.exit(1);
    }
}

// ======================
// Botni ishga tushirish
// ======================
async function startBot() {
    await connectToMongo();
    await update_required_channels();

    try {
        const me = await bot.getMe();
        BOT_USERNAME = me.username;
        console.log(`🤖 Bot ishga tushdi: @${BOT_USERNAME}`);
        bot.startPolling();
        console.log("Polling boshlandi...");
    } catch (err) {
        console.error("Botni ishga tushirishda xato:", err);
        process.exit(1);
    }

    console.log("Server running on port 5000");
}

// ======================
// Admin va obuna tekshiruvi
// ======================
function is_admin(uid) {
    return ADMIN_IDS.includes(uid);
}

let required_channels = [SUB_CHANNEL];

async function update_required_channels() {
    const doc = await settings.findOne({ key: "additional_channels" });
    required_channels = [SUB_CHANNEL].concat(doc?.channels || []);
}

function get_required_channels() {
    return required_channels;
}

async function is_subscribed(user_id) {
    const channels = get_required_channels();
    for (let channel of channels) {
        try {
            const member = await bot.getChatMember(`@${channel}`, user_id);
            if (!['member', 'creator', 'administrator'].includes(member.status)) {
                return false;
            }
        } catch {
            return false;
        }
    }
    return true;
}

async function is_banned(user_id) {
    return await banned_users.findOne({ user_id }) !== null;
}

async function is_premium(user_id) {
    const premium = await premiums.findOne({ user_id });
    if (!premium || !premium.end_date) return false;

    const endDate = new Date(premium.end_date);
    if (isNaN(endDate.getTime())) {
        await premiums.deleteOne({ user_id }); // buzilgan ma'lumotni tozalash
        return false;
    }

    if (new Date() > endDate) {
        await premiums.deleteOne({ user_id });
        return false;
    }
    return true;
}

async function send_premium_reminder(user_id) {
    const premium = await premiums.findOne({ user_id });
    if (!premium || !premium.end_date) return;

    const endDate = new Date(premium.end_date);
    if (isNaN(endDate.getTime())) return;

    const days_left = Math.ceil((endDate - new Date()) / (1000 * 60 * 60 * 24));
    if (days_left <= 3 && days_left > 0) {
        bot.sendMessage(user_id, `⚠️ Rimika Pro muddati tugayabdi! (${days_left} kun qoldi). Yana sotib olishni xohlaysizmi? /start orqali.`);
    }
}

async function check_subscription_and_proceed(chat_id, serial_id, part = 1) {
    const user_id = chat_id;
    if (await is_banned(user_id)) {
        bot.sendMessage(chat_id, `🚫 Siz botdan bloklangansiz. Admin: @${ADMIN_USERNAME}`);
        return;
    }

    if (!(await is_subscribed(user_id))) {
        const markup = { inline_keyboard: [] };
        const channels = get_required_channels();
        for (let ch of channels) {
            markup.inline_keyboard.push([{ text: `📢 @${ch}`, url: `https://t.me/${ch}` }]);
        }
        markup.inline_keyboard.push([{ text: "✅ Tekshirish", callback_data: `check_sub_play_${serial_id}_${part}` }]);
        bot.sendMessage(chat_id, "❌ Anime tomosha qilish uchun quyidagi kanallarga obuna bo‘ling:", { reply_markup: markup });
        return;
    }

    send_episode(chat_id, serial_id, part);
}

// ======================
// Daraja funksiyasi
// ======================
function get_level_and_badge(watched) {
    if (watched >= 500) return { level: "Hokage 👑", badge: "hokage" };
    if (watched >= 100) return { level: "Senpai 🔥", badge: "senpai" };
    if (watched >= 10) return { level: "Otaku 🐣", badge: "otaku" };
    return { level: "Yangi boshlovchi 🌱", badge: "beginner" };
}

// ======================
// Start banner
// ======================
async function send_start_banner(chat_id, is_premium_user = false) {
    const total_users = await users.countDocuments({});
    const top_anime = await serials.findOne({}, { sort: { views: -1 } }) || { title: "Hali anime yo‘q", views: 0 };

    const banner_url = "https://i.postimg.cc/yYXCsTkw/photo-2026-01-05-15-32-43.jpg";

    const caption = (
        ". .  ── •✧⛩✧• ── . .\n" +
        "• ❤️ Rimika Uz bilan hammasi yanada ossonroq  o((≧ω≦ ))o\n" +
        "-\n" +
        `📺 Ayni damda 👤 <b>${total_users}</b> ta foydalanuvchi anime tomosha qilmoqda\n` +
        `🔥 Eng ko‘p ko‘rilgan anime — <b>${top_anime.title}</b>\n` +
        `👁 Jami ko‘rishlar: <b>${top_anime.views || 0}</b>\n` +
        `👨‍💻 Dasturchi: @${ADMIN_USERNAME}\n` +
        "🏆 <b>Daraja tizimi</b> – Ko‘proq tomosha qiling va maxsus badge oling!\n\n" +
        "🌱 <b>10 qism</b> → <b>Otaku 🐣</b>\n" +
        "🔥 <b>100 qism</b> → <b>Senpai 🔥</b>\n" +
        "👑 <b>500 qism</b> → <b>Hokage 👑</b>\n\n" +
        "🏆 Darajangizni va shaxsiy badge'ingizni ko'rish uchun tugmani bosing 👇\n" +
        ". .  ── •✧⛩✧• ── . ."
    );

    const markup = {
        inline_keyboard: [
            [{ text: "🔍 Anime qidirish", switch_inline_query_current_chat: "" }],
            [{ text: "🎭 Janr bo‘yicha", callback_data: "genres_list" }, { text: "📢 Yangiliklar", callback_data: "news" }],
            [{ text: "🧠 Qanday ishlaydi?", callback_data: "how_it_works" }, { text: "🏆 Mening darajam", callback_data: "my_level" }],
            [{ text: "📱 Bizning web", web_app: { url: "https://rimika.onrender.com" } }],
            [{ text: "💎 Rimika Pro", callback_data: "get_rimika_pro" }]
        ]
    };

    try {
        await bot.sendPhoto(chat_id, banner_url, { caption, reply_markup: markup, parse_mode: "HTML" });
    } catch {
        await bot.sendMessage(chat_id, caption, { reply_markup: markup, parse_mode: "HTML" });
    }
}

// ======================
// Rimika Pro sahifasi
// ======================
async function send_pro_page(chat_id, is_premium = false) {
    let caption = (
        "💎 <b>RIMIKA PRO — MAXSUS IMKONIYATLAR</b>\n\n" +
        "✨ <b>Pro foydalanuvchilar uchun:</b>\n" +
        "• Videolarni saqlab olish mumkin (download)\n" +
        "• Do'stlarga yuborish mumkin (forward yoqilgan)\n" +
        "• Tezroq va sifatli tomosha\n" +
        "• Maxsus badge va ustunliklar kelajakda ⚡️\n\n"
    );

    const markup = { inline_keyboard: [] };

    if (is_premium) {
        const premium = await premiums.findOne({ user_id: chat_id });
        const endDate = new Date(premium.end_date);
        caption += `🎉 <b>Sizda Rimika Pro faol!</b>\nMuddati: ${endDate.toLocaleDateString('uz-UZ')} gacha.\n\nTez orada tugaydi? Yana sotib oling ❤️`;
        markup.inline_keyboard.push([{ text: "🔙 Asosiy menyuga", callback_data: "back_to_main" }]);
    } else {
        caption += "💳 <b>To‘lov variantini tanlang:</b>\n\n";
        markup.inline_keyboard.push(
            [{ text: "❤️ 1 oylik - 10.000 so‘m", callback_data: "select_month_1" }],
            [{ text: "🔥 2 oylik - 18.000 so‘m", callback_data: "select_month_2" }],
            [{ text: "❤️‍🔥 3 oylik - 23.000 so‘m", callback_data: "select_month_3" }],
            [{ text: "🔙 Asosiy menyuga", callback_data: "back_to_main" }]
        );
    }

    const pro_banner = "https://i.postimg.cc/63YBWLjB/photo-2026-01-05-15-23-41.jpg"; // Chiroyli rasm

    try {
        await bot.sendPhoto(chat_id, pro_banner, { caption, reply_markup: markup, parse_mode: "HTML" });
    } catch {
        await bot.sendMessage(chat_id, caption, { reply_markup: markup, parse_mode: "HTML" });
    }
}

// ======================
// /start
// ======================
bot.onText(/\/start/, async (msg) => {
    const user_id = msg.from.id;
    await users.updateOne({ user_id }, { $set: { user_id, watched_episodes: 0 } }, { upsert: true });
    const is_prem = await is_premium(user_id);
    await send_premium_reminder(user_id);

    const args = msg.text.split(' ');
    if (args.length > 1) {
        let payload = args[1].trim();
        let serial_id, part = 1;
        if (payload.includes('_')) {
            [serial_id, part_str] = payload.split('_', 2);
            try {
                part = parseInt(part_str);
            } catch {}
        } else {
            serial_id = payload;
        }

        const anime = await serials.findOne({ _id: serial_id });
        if (!anime) {
            bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
            return;
        }

        if (await episodes.findOne({ serial_id, part })) {
            await check_subscription_and_proceed(msg.chat.id, serial_id, part);
        } else if (await episodes.findOne({ serial_id, part: 1 })) {
            await check_subscription_and_proceed(msg.chat.id, serial_id, 1);
        } else {
            send_trailer_with_poster(msg.chat.id, anime);
        }
        return;
    }

    await send_start_banner(msg.chat.id, is_prem);
});

function send_trailer_with_poster(chat_id, anime) {
    if (anime.poster_file_id) {
        bot.sendPhoto(chat_id, anime.poster_file_id, { caption: `🎬 ${anime.title}` });
    }

    bot.sendVideo(chat_id, anime.trailer, { caption: `🎬 ${anime.title} (Treyler)` });
}

// ======================
// Web App, Callback, Inline Query
// ======================
bot.on('web_app_data', async (msg) => {
    try {
        const data = JSON.parse(msg.web_app_data.data);
        if (data.anime_id) {
            await check_subscription_and_proceed(msg.chat.id, data.anime_id, 1);
        } else if (data.action === "random") {
            const all_anime = await serials.find().toArray();
            if (all_anime.length) {
                const anime = all_anime[Math.floor(Math.random() * all_anime.length)];
                await check_subscription_and_proceed(msg.chat.id, anime._id, 1);
            }
        }
    } catch {
        bot.sendMessage(msg.chat.id, "❌ Web App ma'lumotida xato");
    }
});

bot.on('callback_query', async (query) => {
    bot.answerCallbackQuery(query.id);

    const chat_id = query.message.chat.id;
    const user_id = query.from.id;

    if (query.data === "genres_list") {
        const markup = {
            inline_keyboard: [
                [{ text: "🔥 Action", callback_data: "genre_Action" }, { text: "⚔️ Adventure", callback_data: "genre_Adventure" }],
                [{ text: "😂 Comedy", callback_data: "genre_Comedy" }, { text: "😢 Drama", callback_data: "genre_Drama" }],
                [{ text: "🧙 Fantasy", callback_data: "genre_Fantasy" }, { text: "💕 Romance", callback_data: "genre_Romance" }],
                [{ text: "🚀 Sci-Fi", callback_data: "genre_Sci-Fi" }, { text: "👊 Shounen", callback_data: "genre_Shounen" }],
                [{ text: "☀️ Slice of Life", callback_data: "genre_Slice of Life" }],
                [{ text: "🔙 Orqaga", callback_data: "back_to_start" }]
            ]
        };

        bot.sendMessage(chat_id, "🎭 <b>Janrni tanlang:</b>\n\nTanlaganingizdan keyin shu janrdagi animelar ro‘yxati chiqadi!", { parse_mode: "HTML", reply_markup: markup });
    } else if (query.data.startsWith("genre_")) {
        const genre = query.data.replace("genre_", "");
        const anime_list = await serials.find({ genres: { $regex: genre, $options: "i" } }).limit(20).toArray();

        if (anime_list.length === 0) {
            bot.sendMessage(chat_id, `❌ "${genre}" janrida anime topilmadi.`, {
                reply_markup: { inline_keyboard: [[{ text: "🔙 Janrlarga qaytish", callback_data: "genres_list" }]] }
            });
            return;
        }

        let text = `🎭 <b>${genre}</b> janridagi animelar (${anime_list.length} ta):\n\n`;
        const markup = { inline_keyboard: [] };

        const anime_ids = anime_list.map(a => a._id);
        const first_episodes = await episodes.find({ serial_id: { $in: anime_ids }, part: 1 }).toArray();
        const has_first_map = new Map(first_episodes.map(ep => [ep.serial_id, true]));

        for (let anime of anime_list) {
            const has_episode = has_first_map.has(anime._id);
            const button_text = has_episode ? "▶️ Tomosha qilish" : "📺 Treyler";
            markup.inline_keyboard.push([{
                text: `${button_text} ${anime.title}`,
                url: `https://t.me/${BOT_USERNAME}?start=${anime._id}`
            }]);
        }

        markup.inline_keyboard.push([
            { text: "🔙 Janrlarga qaytish", callback_data: "genres_list" },
            { text: "🏠 Bosh menyuga", callback_data: "back_to_start" }
        ]);

        bot.sendMessage(chat_id, text, { parse_mode: "HTML", reply_markup: markup });
    } else if (query.data === "back_to_start") {
        await send_start_banner(chat_id);
    } else if (query.data === "news") {
        bot.sendMessage(chat_id, `📢 Yangiliklar uchun kanalimiz: @${NEWS_CHANNEL}`, {
            reply_markup: { inline_keyboard: [[{ text: "📢 Kanalga o'tish", url: `https://t.me/${NEWS_CHANNEL}` }]] }
        });
    } else if (query.data === "how_it_works") {
        const text = (
            "🧠 <b>Bot qanday ishlaydi?</b>\n\n" +
            "1. 🔍 Inline qidiruv orqali anime nomini yozing – natijalar chiqadi\n" +
            "2. 🎭 Janr bo‘yicha tugmasidan janr tanlang\n" +
            "3. 🎬 Anime tanlab, ▶️ Tomosha qilish tugmasini bosing\n" +
            "4. Majburiy kanallarga obuna bo'ling (bir marta)\n" +
            "5. Qismlar ketma-ket chiqadi, navigatsiya tugmalari bilan o'ting\n" +
            "6. Har bir ko'rilgan qism uchun daraja oshadi 🏆\n" +
            "7. Shorts versiya uchun Web App tugmasi mavjud\n\n" +
            "Rahmat foydalanganingiz uchun! ❤️"
        );
        bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
    } else if (query.data === "my_level") {
        const user = await users.findOne({ user_id: query.from.id });
        const watched = user?.watched_episodes || 0;
        const { level, badge } = get_level_and_badge(watched);
        const badge_url = BADGE_URLS[badge];

        const caption = (
            `🏆 <b>Sizning darajangiz</b>\n\n` +
            `Ko‘rilgan qismlar: <b>${watched}</b>\n` +
            `Daraja: <b>${level}</b>\n\n` +
            "Yana ko'proq tomosha qiling va keyingi badge'ni oling! 🔥"
        );

        try {
            await bot.sendPhoto(chat_id, badge_url, { caption, parse_mode: "HTML" });
        } catch {
            await bot.sendMessage(chat_id, caption, { parse_mode: "HTML" });
        }
    } else if (query.data.startsWith("check_sub_play_")) {
        const parts = query.data.split("_");
        const serial_id = parts[3];
        const part = parseInt(parts[4]);
        await check_subscription_and_proceed(chat_id, serial_id, part);
    } else if (query.data.startsWith("play_")) {
        const [, serial_id, part] = query.data.split("_");
        await check_subscription_and_proceed(chat_id, serial_id, parseInt(part));
    } else if (query.data === "get_rimika_pro") {
        const is_prem = await is_premium(user_id);
        await send_pro_page(chat_id, is_prem);
    } else if (query.data === "back_to_main") {
        const is_prem = await is_premium(user_id);
        await send_start_banner(chat_id, is_prem);
    } else if (query.data.startsWith("select_month_")) {
        const months = parseInt(query.data.split("_")[2]);
        await temp_payments.updateOne({ user_id }, { $set: { months } }, { upsert: true });

        const prices = {1: 10000, 2: 18000, 3: 23000};
        const price = prices[months];

        const text = (
            `✅ ${months} oylik Rimika Pro tanlandi!\n\n` +
            `💳 Miqdor: <b>${price} so‘m</b>\n` +
            "8600 0604 5432 4832\n" +
            "Amirxon Abduqodirov\n" +
            "────\n" +
            "👆🏻Shu karta raqamga pul o'tkazing.\n" +
            "────\n" +
            "📌 Pul o'tkazilganini tasdiqlovchi chek rasmini yoki skrinshotini botga yuboring."
        );
        bot.sendMessage(chat_id, text, { parse_mode: "HTML" });
    } else if (query.data.startsWith("grant_premium_")) {
        if (!is_admin(user_id)) return;

        const parts = query.data.split("_");
        if (parts.length !== 4) {
            bot.sendMessage(chat_id, "❌ Xato callback ma'lumotlari.");
            return;
        }

        const target_user_id = parts[2];
        const months_str = parts[3];

        const months = parseInt(months_str);
        if (isNaN(months) || months < 1 || months > 12) {
            bot.sendMessage(chat_id, "❌ Noto‘g‘ri oy soni.");
            return;
        }

        const user_id_num = parseInt(target_user_id);
        if (isNaN(user_id_num)) {
            bot.sendMessage(chat_id, "❌ Noto‘g‘ri foydalanuvchi ID.");
            return;
        }

        const end_date = new Date();
        end_date.setDate(end_date.getDate() + months * 30); // taxminiy 30 kunlik oy

        await premiums.updateOne(
            { user_id: user_id_num },
            { $set: { end_date: end_date.toISOString() } },
            { upsert: true }
        );

        bot.sendMessage(chat_id, `✅ Foydalanuvchi ${target_user_id} ga ${months} oylik Rimika Pro berildi!`);
        bot.sendMessage(user_id_num, "🎉 Tabriklaymiz! Sizga Rimika Pro berildi. Endi anime yuklab olish va yuborish mumkin.");
    }
});

bot.on('inline_query', async (query) => {
    const results = [];
    const q = query.query.toLowerCase();
    let anime_list = [];
    if (q.length > 0) {
        anime_list = await serials.find({ title: { $regex: q, $options: "i" } }).limit(20).toArray();
    } else {
        anime_list = await serials.find().sort({ views: -1 }).limit(10).toArray();
    }

    const anime_ids = anime_list.map(a => a._id);
    const first_episodes = await episodes.find({ serial_id: { $in: anime_ids }, part: 1 }).toArray();
    const has_first_map = new Map(first_episodes.map(ep => [ep.serial_id, true]));

    for (let anime of anime_list) {
        const has_first = has_first_map.has(anime._id);
        const button_text = has_first ? "▶️ Tomosha qilish" : "📺 Treyler";
        const url = `https://t.me/${BOT_USERNAME}?start=${anime._id}`;
        const is_top = q.length === 0;
        results.push({
            type: 'article',
            id: is_top ? `top_${anime._id}` : anime._id,
            title: anime.title,
            description: is_top ? `🔥 Mashhur • ${anime.genres || 'N/A'} • 👁 ${anime.views || 0}` : `${anime.genres || ''} • ${anime.total} qism • 👁 ${anime.views || 0}`,
            thumb_url: "https://i.postimg.cc/NjS4n3Q4/photo-2026-01-05-15-35-26.jpg",
            input_message_content: { message_text: `${is_top ? '🔥' : '🎬'} ${anime.title}\n🎭 Janr: ${anime.genres || 'N/A'}\n📦 Qismlar: ${anime.total}\n👁 Ko‘rilgan: ${anime.views || 0}\nID: ${anime._id}` },
            reply_markup: { inline_keyboard: [[{ text: button_text, url }]] }
        });
    }

    bot.answerInlineQuery(query.id, results, { cache_time: q.length > 0 ? 1 : 300 });
});

// ======================
// Episode jo‘natish
// ======================
async function send_episode(chat_id, serial_id, part = 1) {
    const anime = await serials.findOne({ _id: serial_id });
    const episode = await episodes.findOne({ serial_id, part });
    if (!episode) {
        bot.sendMessage(chat_id, "❌ Bu qism hali yuklanmagan");
        return;
    }

    await serials.updateOne({ _id: serial_id }, { $inc: { views: 1 } });
    await users.updateOne({ user_id: chat_id }, { $inc: { watched_episodes: 1 } });

    const markup = { inline_keyboard: [] };
    const total_parts = anime.total;
    const PAGE_SIZE = 50;
    const BUTTONS_PER_ROW = 5;

    let start, end;
    if (total_parts <= PAGE_SIZE) {
        start = 1;
        end = total_parts + 1;
    } else {
        const current_page = Math.ceil(part / PAGE_SIZE);
        start = (current_page - 1) * PAGE_SIZE + 1;
        end = Math.min(start + PAGE_SIZE, total_parts + 1);
    }

    const existing_parts_docs = await episodes.find({ serial_id, part: { $gte: start, $lt: end } }).project({ part: 1 }).toArray();
    const existing_parts = new Set(existing_parts_docs.map(doc => doc.part));

    const buttons = [];
    for (let p = start; p < end; p++) {
        const exists = existing_parts.has(p);
        const label = p === part ? `▶️ ${p}` : (exists ? `${p}` : `${p} ⚠️`);
        buttons.push({ text: label, callback_data: exists ? `play_${serial_id}_${p}` : "none" });
    }

    while (buttons.length > 0) {
        markup.inline_keyboard.push(buttons.splice(0, BUTTONS_PER_ROW));
    }

    const nav = [];
    if (start > 1) {
        nav.push({ text: "◀️ Orqaga", callback_data: `play_${serial_id}_${start - PAGE_SIZE}` });
    }
    if (end <= total_parts) {
        nav.push({ text: "Keyingi ▶️", callback_data: `play_${serial_id}_${end}` });
    }
    if (nav.length) {
        markup.inline_keyboard.push(nav);
    }

    const is_prem = await is_premium(chat_id);
    if (is_prem) {
        // Premium: Yuklab olish va yuborish mumkin (forward yoqilgan)
        bot.sendVideo(chat_id, episode.file_id, { caption: `${anime.title} — ${part}-qism (Premium: Saqlash va yuborish mumkin)`, reply_markup: markup, protect_content: false });
    } else {
        // Oddiy: Yuklab olish va forward taqiqlangan
        bot.sendVideo(chat_id, episode.file_id, { caption: `${anime.title} — ${part}-qism (Faqat ko'rish mumkin)`, reply_markup: markup, protect_content: true });
    }
}

// ======================
// Chek rasmini qabul qilish (photo listener)
// ======================
bot.on('photo', async (msg) => {
    const user_id = msg.from.id;
    if (await is_premium(user_id)) return; // Premium bo'lsa, chek emas

    const temp = await temp_payments.findOne({ user_id });
    if (!temp || !temp.months) {
        bot.sendMessage(msg.chat.id, "❌ Avval to‘lov variantini tanlang! /start → 💎 Rimika Pro");
        return;
    }

    const months = temp.months;
    const photo_file_id = msg.photo[msg.photo.length - 1].file_id;

    // Kanalga yuboramiz
    const caption = `Yangi chek:\nFoydalanuvchi ID: ${user_id}\nNechi oylik: ${months}\n\nRimika Pro berish uchun tugmani bosing.`;
    const markup = {
        inline_keyboard: [[{ text: "💎 Rimika Pro berish", callback_data: `grant_premium_${user_id}_${months}` }]]
    };
    await bot.sendPhoto(`@${PAYMENT_CHECK_CHANNEL}`, photo_file_id, { caption, reply_markup: markup });

    bot.sendMessage(msg.chat.id, "✅ Chekingiz yuborildi! Admin tez orada tekshiradi.");
    await temp_payments.deleteOne({ user_id }); // Temp ni o'chirish
});

// ======================
// ADMIN BUYRUQLARI
// ======================

// YANGI BUYRUQ: Treyler qayta yuborish (admin + kanalga)
bot.onText(/\/resendtrailer(?:\s+(.+))?/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;

    const sid = match[1]?.trim();
    if (!sid) {
        return bot.sendMessage(msg.chat.id, "❌ Foydalanish: /resendtrailer <anime_id>\nMisol: /resendtrailer abc123-def456");
    }

    const anime = await serials.findOne({ _id: sid });
    if (!anime) {
        return bot.sendMessage(msg.chat.id, "❌ Berilgan ID bo‘yicha anime topilmadi.");
    }

    if (!anime.trailer) {
        return bot.sendMessage(msg.chat.id, `❌ ${anime.title} animening treyleri hali yuklanmagan.`);
    }

    let successAdmin = false;
    let successChannel = false;

    // Admin chatiga yuborish
    try {
        await send_anime_card(msg.chat.id, sid);
        successAdmin = true;
    } catch (err) {
        console.error("Admin chatiga yuborishda xato:", err);
    }

    // Kanalga yuborish (@SakuramiTG)
    try {
        await send_anime_card(`@${SUB_CHANNEL}`, sid);
        successChannel = true;
    } catch (err) {
        console.error("Kanalga yuborishda xato:", err);
    }

    // Natija haqida xabar
    if (successAdmin && successChannel) {
        bot.sendMessage(msg.chat.id, `✅ ${anime.title} treyleri admin chatiga va @${SUB_CHANNEL} kanaliga yuborildi!`);
    } else if (successAdmin) {
        bot.sendMessage(msg.chat.id, `✅ Admin chatiga yuborildi, lekin kanalga yuborishda xato (bot admin emasmi?).`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ Treyler yuborishda xato yuz berdi.");
    }
});

bot.onText(/\/changetrailer(?:\s+(.+))?/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;
    const sid = match[1]?.trim();
    if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /changetrailer <anime_id>");
    const anime = await serials.findOne({ _id: sid });
    if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    bot.sendMessage(msg.chat.id, `Yangi treyler videoni yuboring (${anime.title} uchun):`);
    bot.once('video', async (videoMsg) => {
        if (videoMsg.from.id !== msg.from.id) return;
        await serials.updateOne({ _id: sid }, { $set: { trailer: videoMsg.video.file_id } });
        bot.sendMessage(msg.chat.id, `✅ ${anime.title} treyleri yangilandi!`);
        try { await send_anime_card(`@${SUB_CHANNEL}`, sid); } catch {}
    });
});

// Qolgan admin buyruqlari (o‘zgarmagan)
bot.onText(/\/addposter(?:\s+(.+))?/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;
    const sid = match[1]?.trim();
    if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /addposter <anime_id>");
    const anime = await serials.findOne({ _id: sid });
    if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    bot.sendMessage(msg.chat.id, `Poster rasmni yuboring (${anime.title} uchun):`);
    bot.once('photo', async (photoMsg) => {
        if (photoMsg.from.id !== msg.from.id) return;
        const file_id = photoMsg.photo[photoMsg.photo.length - 1].file_id;
        await serials.updateOne({ _id: sid }, { $set: { poster_file_id: file_id } });
        bot.sendMessage(msg.chat.id, `✅ ${anime.title} poster qo‘shildi/yangilandi!`);
    });
});

bot.onText(/\/animeinfo(?:\s+(.+))?/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;
    const sid = match[1]?.trim();
    if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /animeinfo <anime_id>");
    const anime = await serials.findOne({ _id: sid });
    if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    const epsCount = await episodes.countDocuments({ serial_id: sid });
    const text = `
🎬 <b>Anime Ma'lumotlari</b>

<b>Nom:</b> ${anime.title}
<b>ID:</b> <code>${anime._id}</code>
<b>Umumiy qismlar:</b> ${anime.total}
<b>Yuklangan qismlar:</b> ${epsCount}
<b>Janrlar:</b> ${anime.genres || 'Yo‘q'}
<b>Ko‘rishlar:</b> ${anime.views || 0}
    `.trim();
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/animelist/, async (msg) => {
    if (!is_admin(msg.from.id)) return;
    const all = await serials.find().sort({ title: 1 }).toArray();
    if (all.length === 0) return bot.sendMessage(msg.chat.id, "❌ Hozircha anime yo‘q");

    const episode_counts = await episodes.aggregate([
        { $group: { _id: "$serial_id", count: { $sum: 1 } } }
    ]).toArray();
    const serial_counts = new Map(episode_counts.map(c => [c._id, c.count]));

    let text = `<b>📋 Anime Ro‘yxati (${all.length} ta)</b>\n\n`;
    for (let a of all) {
        const eps = serial_counts.get(a._id) || 0;
        text += `<b>${a.title}</b>\n<code>${a._id}</code> | ${eps}/${a.total} qism\n\n`;
    }
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/adminlist/, (msg) => {
    if (!is_admin(msg.from.id)) return;
    const list = ADMIN_IDS.map(id => `• <code>${id}</code>`).join("\n");
    bot.sendMessage(msg.chat.id, `<b>👑 Adminlar:</b>\n${list}`, { parse_mode: "HTML" });
});

bot.onText(/\/deletepart(?:\s+(.+))\s+(\d+)/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;
    const sid = match[1]?.trim();
    const part = parseInt(match[2]);
    if (!sid || isNaN(part)) return bot.sendMessage(msg.chat.id, "Foydalanish: /deletepart <anime_id> <qism_raqami>");
    const anime = await serials.findOne({ _id: sid });
    if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    const result = await episodes.deleteOne({ serial_id: sid, part });
    if (result.deletedCount > 0) {
        bot.sendMessage(msg.chat.id, `✅ ${anime.title} — ${part}-qism o‘chirildi`);
    } else {
        bot.sendMessage(msg.chat.id, "❌ Bu qism topilmadi");
    }
});

bot.onText(/\/resetviews(?:\s+(.+))?/, async (msg, match) => {
    if (!is_admin(msg.from.id)) return;
    const sid = match[1]?.trim();
    if (!sid) return bot.sendMessage(msg.chat.id, "Foydalanish: /resetviews <anime_id>");
    const anime = await serials.findOne({ _id: sid });
    if (!anime) return bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
    await serials.updateOne({ _id: sid }, { $set: { views: 0 } });
    bot.sendMessage(msg.chat.id, `✅ ${anime.title} ko‘rishlar soni 0 ga tushirildi`);
});

bot.onText(/\/stats/, async (msg) => {
    if (!is_admin(msg.from.id)) return;
    const total_users = await users.countDocuments({});
    const total_anime = await serials.countDocuments({});
    const total_episodes = await episodes.countDocuments({});
    const total_views = (await serials.aggregate([{ $group: { _id: null, total: { $sum: "$views" } } }]).toArray())[0]?.total || 0;
    const top5 = await serials.find().sort({ views: -1 }).limit(5).toArray();

    let text = (
        "📊 <b>Bot Statistika</b>\n\n" +
        `👥 Foydalanuvchilar: <b>${total_users}</b>\n` +
        `🎬 Anime soni: <b>${total_anime}</b>\n` +
        `📼 Qismlar soni: <b>${total_episodes}</b>\n` +
        `👁 Jami ko‘rishlar: <b>${total_views}</b>\n\n` +
        "<b>🔥 Top 5 anime:</b>\n"
    );
    top5.forEach((a, i) => {
        text += `${i + 1}. ${a.title} — ${a.views || 0} ko‘rish\n`;
    });

    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/deleteanime/, (msg) => {
    if (!is_admin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "🗑 O‘chiriladigan anime ID:").then(() => {
        bot.once('message', async (response) => {
            const sid = response.text.trim();
            const anime = await serials.findOne({ _id: sid });
            if (!anime) {
                bot.sendMessage(response.chat.id, "❌ Topilmadi");
                return;
            }
            await serials.deleteOne({ _id: sid });
            await episodes.deleteMany({ serial_id: sid });
            bot.sendMessage(response.chat.id, `✅ ${anime.title} o‘chirildi`);
        });
    });
});

bot.onText(/\/editanime/, (msg) => {
    if (!is_admin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "✏️ Tahrirlanadigan anime ID:").then(() => {
        bot.once('message', async (response) => {
            const sid = response.text.trim();
            const anime = await serials.findOne({ _id: sid });
            if (!anime) {
                bot.sendMessage(response.chat.id, "❌ Topilmadi");
                return;
            }
            const context = { sid };
            bot.sendMessage(response.chat.id, `Joriy nom: ${anime.title}\nYangi nom (/skip):`).then(() => {
                bot.once('message', (res) => edit_title(res, context));
            });
        });
    });
});

async function edit_title(msg, ctx) {
    if (msg.text !== "/skip") {
        await serials.updateOne({ _id: ctx.sid }, { $set: { title: msg.text } });
    }
    bot.sendMessage(msg.chat.id, "Yangi qismlar soni (/skip):").then(() => {
        bot.once('message', (res) => edit_total(res, ctx));
    });
}

async function edit_total(msg, ctx) {
    if (msg.text !== "/skip") {
        try {
            const total = parseInt(msg.text);
            await serials.updateOne({ _id: ctx.sid }, { $set: { total } });
        } catch {}
    }
    bot.sendMessage(msg.chat.id, "Yangi janrlar (/skip):").then(() => {
        bot.once('message', (res) => edit_genres(res, ctx));
    });
}

async function edit_genres(msg, ctx) {
    if (msg.text !== "/skip") {
        await serials.updateOne({ _id: ctx.sid }, { $set: { genres: msg.text } });
    }
    bot.sendMessage(msg.chat.id, "✅ Yangilandi!");
}

bot.on('video', async (msg) => {
    if (is_admin(msg.from.id) && msg.caption && msg.caption.trim().toLowerCase() === "/uploadpart") {
        bot.replyToMessage(msg.chat.id, msg.message_id, "Video qabul qilindi! Anime ID yuboring:").then(() => {
            bot.once('message', (res) => upload_part_id(res, msg.video.file_id));
        });
    }
});

async function upload_part_id(msg, file_id) {
    const sid = msg.text.trim();
    if (!(await serials.findOne({ _id: sid }))) {
        bot.sendMessage(msg.chat.id, "❌ Anime topilmadi");
        return;
    }
    const context = { sid, file_id };
    bot.sendMessage(msg.chat.id, "Qism raqami:").then(() => {
        bot.once('message', (res) => upload_part_num(res, context));
    });
}

async function upload_part_num(msg, ctx) {
    try {
        const part = parseInt(msg.text);
        await episodes.updateOne(
            { serial_id: ctx.sid, part },
            { $set: { file_id: ctx.file_id } },
            { upsert: true }
        );
        bot.sendMessage(msg.chat.id, `✅ ${ctx.sid} — ${part}-qism saqlandi`);
    } catch {
        bot.sendMessage(msg.chat.id, "❌ Raqam kiriting");
    }
}

bot.onText(/\/ban/, async (msg) => {
    if (!is_admin(msg.from.id)) return;
    try {
        const uid = parseInt(msg.text.split(' ')[1]);
        await banned_users.updateOne({ user_id: uid }, { $set: { user_id: uid } }, { upsert: true });
        bot.sendMessage(msg.chat.id, `🚫 ${uid} bloklandi`);
    } catch {
        bot.sendMessage(msg.chat.id, "Foydalanish: /ban <user_id>");
    }
});

bot.onText(/\/unban/, async (msg) => {
    if (!is_admin(msg.from.id)) return;
    try {
        const uid = parseInt(msg.text.split(' ')[1]);
        await banned_users.deleteOne({ user_id: uid });
        bot.sendMessage(msg.chat.id, `✅ ${uid} blokdan chiqdi`);
    } catch {
        bot.sendMessage(msg.chat.id, "Foydalanish: /unban <user_id>");
    }
});

bot.onText(/\/about/, (msg) => {
    const text = (
        "🤖 <b>Kawaii Uz Anime Bot</b>\n" +
        `📌 Versiya: <b>${BOT_VERSION}</b>\n` +
        `👨‍💻 Yaratuvchi: @${ADMIN_USERNAME}\n\n` +
        "Anime qidirish, ketma-ket tomosha bilan!"
    );
    bot.sendMessage(msg.chat.id, text, { parse_mode: "HTML" });
});

bot.onText(/\/addelon/, (msg) => {
    if (!is_admin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "📢 Rasm yuboring (yo‘q bo‘lsa /skip):").then(() => {
        bot.once('message', (res) => add_elon_photo(res));
    });
});

async function add_elon_photo(msg) {
    const ctx = {};
    if (msg.photo) {
        ctx.photo = msg.photo[msg.photo.length - 1].file_id;
        bot.sendMessage(msg.chat.id, "Matnni yozing:").then(() => {
            bot.once('message', (res) => add_elon_text(res, ctx));
        });
    } else if (msg.text === "/skip") {
        ctx.photo = null;
        bot.sendMessage(msg.chat.id, "Matnni yozing:").then(() => {
            bot.once('message', (res) => add_elon_text(res, ctx));
        });
    } else {
        bot.sendMessage(msg.chat.id, "❌ Rasm yoki /skip");
    }
}

async function add_elon_text(msg, ctx) {
    const text = msg.text;
    let sent = 0;
    const cursor = users.find();
    for await (const user of cursor) {
        try {
            if (ctx.photo) {
                await bot.sendPhoto(user.user_id, ctx.photo, { caption: text, parse_mode: "HTML" });
            } else {
                await bot.sendMessage(user.user_id, text, { parse_mode: "HTML" });
            }
            sent++;
        } catch {}
    }
    bot.sendMessage(msg.chat.id, `✅ ${sent} ta foydalanuvchiga yuborildi`);
}

bot.onText(/\/(addchannel|removechannel|listchannels)/, async (msg) => {
    if (!is_admin(msg.from.id)) return;
    const cmd = msg.text.split(' ')[0];
    if (cmd === "/addchannel") {
        bot.sendMessage(msg.chat.id, "Yangi kanal username:").then(() => {
            bot.once('message', (res) => add_channel(res));
        });
    } else if (cmd === "/removechannel") {
        bot.sendMessage(msg.chat.id, "O‘chiriladigan kanal username:").then(() => {
            bot.once('message', (res) => remove_channel(res));
        });
    } else if (cmd === "/listchannels") {
        const channels = get_required_channels();
        const text = "📋 Majburiy kanallar:\n" + channels.map(c => `• @${c}`).join("\n");
        bot.sendMessage(msg.chat.id, text);
    }
});

async function add_channel(msg) {
    const ch = msg.text.trim().replace(/^@/, '');
    await settings.updateOne({ key: "additional_channels" }, { $addToSet: { channels: ch } }, { upsert: true });
    await update_required_channels();
    bot.sendMessage(msg.chat.id, `✅ @${ch} qo‘shildi`);
}

async function remove_channel(msg) {
    const ch = msg.text.trim().replace(/^@/, '');
    const result = await settings.updateOne({ key: "additional_channels" }, { $pull: { channels: ch } });
    await update_required_channels();
    bot.sendMessage(msg.chat.id, result.modifiedCount ? "✅ O‘chirildi" : "❌ Topilmadi");
}

// ======================
// Anime qo'shish
// ======================
bot.onText(/\/addanime/, (msg) => {
    if (!is_admin(msg.from.id)) return;
    bot.sendMessage(msg.chat.id, "Anime nomini yozing:").then(() => {
        bot.once('message', (res) => step_title(res));
    });
});

async function step_title(msg) {
    const data = { title: msg.text };
    bot.sendMessage(msg.chat.id, "Nechta qismi bor?").then(() => {
        bot.once('message', (res) => step_total(res, data));
    });
}

async function step_total(msg, data) {
    try {
        data.total = parseInt(msg.text);
    } catch {
        data.total = 1;
    }
    bot.sendMessage(msg.chat.id, "Janrlarini yozing:").then(() => {
        bot.once('message', (res) => step_genres(res, data));
    });
}

async function step_genres(msg, data) {
    data.genres = msg.text;
    bot.sendMessage(msg.chat.id, "Treyler videoni yuboring:").then(() => {
        bot.once('message', (res) => save_trailer(res, data));
    });
}

async function save_trailer(msg, data) {
    if (!msg.video) {
        bot.sendMessage(msg.chat.id, "❌ Video yuboring!");
        return;
    }

    const serial_id = uuidv4();

    await serials.insertOne({
        _id: serial_id,
        title: data.title,
        total: data.total,
        genres: data.genres,
        trailer: msg.video.file_id,
        poster_file_id: null
    });

    await send_anime_card(msg.chat.id, serial_id);

    bot.sendMessage(msg.chat.id, `✅ Anime qo‘shildi! ID: ${serial_id}`);
}

async function send_anime_card(chat_id, serial_id) {
    const anime = await serials.findOne({ _id: serial_id });
    if (!anime) return;

    const markup = {
        inline_keyboard: [[{ text: "▶️ Ko‘rish", url: `https://t.me/${BOT_USERNAME}?start=${serial_id}` }]]
    };

    const caption = `
🎌 <b>Yangi Anime Qo‘shildi!</b> 🎌

🎬 <b>Nomi:</b> ${anime.title}
📦 <b>Qismlar soni:</b> ${anime.total}
🎭 <b>Janr:</b> ${anime.genres}

🆔 <b>ID:</b> <code>${serial_id}</code>

❤️ Rimika Uz bilan birga tomosha qiling!
    `.trim();

    await bot.sendVideo(chat_id, anime.trailer, {
        caption,
        reply_markup: markup,
        parse_mode: "HTML"
    });
}

// ======================
// Kanalga qism yuklash
// ======================
bot.on('channel_post', async (msg) => {
    if (msg.chat.username !== UPLOAD_CHANNEL || !msg.video || !msg.caption) return;

    let serial_id = null;
    let part = null;
    for (let line of msg.caption.split("\n")) {
        if (line.toLowerCase().startsWith("id:")) {
            serial_id = line.split(":", 2)[1].trim();
        }
        if (line.toLowerCase().startsWith("qism:")) {
            try {
                part = parseInt(line.split(":", 2)[1].trim());
            } catch {}
        }
    }

    if (serial_id && part) {
        await episodes.updateOne(
            { serial_id, part },
            { $set: { file_id: msg.video.file_id } },
            { upsert: true }
        );
        bot.sendMessage(ADMIN_IDS[0], `✅ ${serial_id} — ${part}-qism saqlandi!`);
    }
});

// ======================
// Express server
// ======================
const app = express();

app.get("/", (req, res) => {
    res.status(200).send("Anime Bot ishlayapti ✨");
});

app.listen(5000);

// Botni ishga tushiramiz
startBot();