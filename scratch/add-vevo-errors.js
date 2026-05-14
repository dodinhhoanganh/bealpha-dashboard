// Batch add vevoErrors section to all locale files
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, '..', 'lib', 'i18n', 'translations');

const vevoErrorsEN = {
  ERROR_VEVO_ONLY_MP4_OR_MOV: "Only .mp4 or .mov video formats are accepted (VEVO standard).",
  ERROR_VEVO_NO_VIDEO_STREAM: "No video stream found in the file.",
  ERROR_VEVO_INTERLACED_VIDEO: "Video must not be interlaced. Progressive Scan is required.",
  ERROR_VEVO_INVALID_VIDEO_CODEC: "Video codec must be H.264 or ProRes.",
  ERROR_VEVO_INVALID_RESOLUTION: "Resolution must be 1920x1080 (HD), 2560x1440 (2K), or 3840x2160 (4K).",
  ERROR_VEVO_PORTRAIT_VIDEO_UNDER_3MIN: "VEVO does not support portrait/square videos under 3 minutes (YouTube Shorts policy).",
  ERROR_VEVO_LOW_FRAME_RATE: "Frame rate must be at least 23.98 fps.",
  ERROR_VEVO_LOW_VIDEO_BITRATE: "Video bit rate must be at least {0}Mbps.",
  ERROR_VEVO_NO_AUDIO_STREAM: "No audio stream found in the file.",
  ERROR_VEVO_INVALID_AUDIO_CODEC: "Audio codec must be AAC or LPCM.",
  ERROR_VEVO_LOW_SAMPLE_RATE: "Audio sample rate must be at least 44.1kHz.",
  ERROR_VEVO_NOT_STEREO: "Audio must be Stereo (2 channels).",
  ERROR_VEVO_LOW_AUDIO_BITRATE: "Audio bit rate must be at least 320kbps.",
  ERROR_VEVO_LETTERBOXING_DETECTED: "Letterboxing/Pillarboxing detected. VEVO does not accept videos with static black borders.",
  ERROR_VEVO_SLATES_DETECTED: "Front/End slates detected. VEVO does not accept slate or countdown videos.",
  ERROR_VEVO_PROBE_FAILED: "Could not read video information.",
  ERROR_COVER_MUST_BE_SQUARE: "Cover image must be square.",
  ERROR_COVER_MIN_3000X3000: "Minimum resolution is 3000x3000 pixels.",
  ERROR_COVER_MAX_6000X6000: "Maximum resolution is 6000x6000 pixels.",
};

const overrides = {
  ja: {
    ERROR_VEVO_NO_VIDEO_STREAM: "ファイル内にビデオストリームが見つかりません。",
    ERROR_VEVO_INTERLACED_VIDEO: "インターレース動画は使用できません。プログレッシブスキャンが必要です。",
    ERROR_VEVO_INVALID_VIDEO_CODEC: "ビデオコーデックはH.264またはProResである必要があります。",
    ERROR_VEVO_INVALID_RESOLUTION: "解像度は1920x1080 (HD)、2560x1440 (2K)、または3840x2160 (4K)が必要です。",
    ERROR_VEVO_NO_AUDIO_STREAM: "ファイル内にオーディオストリームが見つかりません。",
    ERROR_VEVO_NOT_STEREO: "オーディオはステレオ (2チャンネル) である必要があります。",
    ERROR_COVER_MUST_BE_SQUARE: "カバー画像は正方形である必要があります。",
    ERROR_COVER_MIN_3000X3000: "最小解像度は3000x3000ピクセルです。",
    ERROR_COVER_MAX_6000X6000: "最大解像度は6000x6000ピクセルです。",
  },
  ko: {
    ERROR_VEVO_NO_VIDEO_STREAM: "파일에서 비디오 스트림을 찾을 수 없습니다.",
    ERROR_VEVO_INTERLACED_VIDEO: "인터레이스 비디오는 허용되지 않습니다. 프로그레시브 스캔이 필요합니다.",
    ERROR_VEVO_INVALID_VIDEO_CODEC: "비디오 코덱은 H.264 또는 ProRes여야 합니다.",
    ERROR_VEVO_NO_AUDIO_STREAM: "파일에서 오디오 스트림을 찾을 수 없습니다.",
    ERROR_VEVO_NOT_STEREO: "오디오는 스테레오 (2채널)여야 합니다.",
    ERROR_COVER_MUST_BE_SQUARE: "커버 이미지는 정사각형이어야 합니다.",
    ERROR_COVER_MIN_3000X3000: "최소 해상도는 3000x3000 픽셀입니다.",
    ERROR_COVER_MAX_6000X6000: "최대 해상도는 6000x6000 픽셀입니다.",
  },
  zh: {
    ERROR_VEVO_NO_VIDEO_STREAM: "文件中未找到视频流。",
    ERROR_VEVO_INTERLACED_VIDEO: "视频不得为隔行扫描，需要逐行扫描。",
    ERROR_VEVO_INVALID_VIDEO_CODEC: "视频编解码器必须为H.264或ProRes。",
    ERROR_VEVO_NO_AUDIO_STREAM: "文件中未找到音频流。",
    ERROR_VEVO_NOT_STEREO: "音频必须为立体声（2声道）。",
    ERROR_COVER_MUST_BE_SQUARE: "封面图片必须为正方形。",
    ERROR_COVER_MIN_3000X3000: "最低分辨率为3000x3000像素。",
    ERROR_COVER_MAX_6000X6000: "最高分辨率为6000x6000像素。",
  },
  de: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Kein Videostream in der Datei gefunden.",
    ERROR_VEVO_NOT_STEREO: "Audio muss Stereo (2 Kanäle) sein.",
    ERROR_COVER_MUST_BE_SQUARE: "Coverbild muss quadratisch sein.",
    ERROR_COVER_MIN_3000X3000: "Mindestauflösung beträgt 3000x3000 Pixel.",
    ERROR_COVER_MAX_6000X6000: "Maximalauflösung beträgt 6000x6000 Pixel.",
  },
  fr: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Aucun flux vidéo trouvé dans le fichier.",
    ERROR_VEVO_NOT_STEREO: "L'audio doit être en stéréo (2 canaux).",
    ERROR_COVER_MUST_BE_SQUARE: "L'image de couverture doit être carrée.",
    ERROR_COVER_MIN_3000X3000: "Résolution minimale de 3000x3000 pixels.",
    ERROR_COVER_MAX_6000X6000: "Résolution maximale de 6000x6000 pixels.",
  },
  es: {
    ERROR_VEVO_NO_VIDEO_STREAM: "No se encontró flujo de video en el archivo.",
    ERROR_VEVO_NOT_STEREO: "El audio debe ser estéreo (2 canales).",
    ERROR_COVER_MUST_BE_SQUARE: "La imagen de portada debe ser cuadrada.",
    ERROR_COVER_MIN_3000X3000: "Resolución mínima de 3000x3000 píxeles.",
    ERROR_COVER_MAX_6000X6000: "Resolución máxima de 6000x6000 píxeles.",
  },
  pt: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Nenhum fluxo de vídeo encontrado no arquivo.",
    ERROR_VEVO_NOT_STEREO: "O áudio deve ser estéreo (2 canais).",
    ERROR_COVER_MUST_BE_SQUARE: "A imagem de capa deve ser quadrada.",
    ERROR_COVER_MIN_3000X3000: "Resolução mínima de 3000x3000 pixels.",
    ERROR_COVER_MAX_6000X6000: "Resolução máxima de 6000x6000 pixels.",
  },
  ru: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Видеопоток не найден в файле.",
    ERROR_VEVO_NOT_STEREO: "Аудио должно быть стерео (2 канала).",
    ERROR_COVER_MUST_BE_SQUARE: "Обложка должна быть квадратной.",
    ERROR_COVER_MIN_3000X3000: "Минимальное разрешение 3000x3000 пикселей.",
    ERROR_COVER_MAX_6000X6000: "Максимальное разрешение 6000x6000 пикселей.",
  },
  th: {
    ERROR_VEVO_NO_VIDEO_STREAM: "ไม่พบสตรีมวิดีโอในไฟล์",
    ERROR_VEVO_NOT_STEREO: "เสียงต้องเป็นสเตอริโอ (2 ช่องสัญญาณ)",
    ERROR_COVER_MUST_BE_SQUARE: "รูปปกต้องเป็นรูปสี่เหลี่ยมจัตุรัส",
    ERROR_COVER_MIN_3000X3000: "ความละเอียดขั้นต่ำ 3000x3000 พิกเซล",
    ERROR_COVER_MAX_6000X6000: "ความละเอียดสูงสุด 6000x6000 พิกเซล",
  },
  ar: {
    ERROR_VEVO_NO_VIDEO_STREAM: "لم يتم العثور على بث فيديو في الملف.",
    ERROR_VEVO_NOT_STEREO: "يجب أن يكون الصوت ستيريو (قناتان).",
    ERROR_COVER_MUST_BE_SQUARE: "يجب أن تكون صورة الغلاف مربعة.",
    ERROR_COVER_MIN_3000X3000: "الحد الأدنى للدقة 3000x3000 بكسل.",
    ERROR_COVER_MAX_6000X6000: "الحد الأقصى للدقة 6000x6000 بكسل.",
  },
  hi: {
    ERROR_VEVO_NO_VIDEO_STREAM: "फ़ाइल में कोई वीडियो स्ट्रीम नहीं मिला।",
    ERROR_VEVO_NOT_STEREO: "ऑडियो स्टीरियो (2 चैनल) होना चाहिए।",
    ERROR_COVER_MUST_BE_SQUARE: "कवर छवि वर्गाकार होनी चाहिए।",
    ERROR_COVER_MIN_3000X3000: "न्यूनतम रिज़ॉल्यूशन 3000x3000 पिक्सेल।",
    ERROR_COVER_MAX_6000X6000: "अधिकतम रिज़ॉल्यूशन 6000x6000 पिक्सेल।",
  },
  id: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Tidak ditemukan stream video dalam file.",
    ERROR_VEVO_NOT_STEREO: "Audio harus Stereo (2 channel).",
    ERROR_COVER_MUST_BE_SQUARE: "Gambar sampul harus persegi.",
    ERROR_COVER_MIN_3000X3000: "Resolusi minimum 3000x3000 piksel.",
    ERROR_COVER_MAX_6000X6000: "Resolusi maksimum 6000x6000 piksel.",
  },
  it: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Nessun flusso video trovato nel file.",
    ERROR_VEVO_NOT_STEREO: "L'audio deve essere stereo (2 canali).",
    ERROR_COVER_MUST_BE_SQUARE: "L'immagine di copertina deve essere quadrata.",
    ERROR_COVER_MIN_3000X3000: "Risoluzione minima 3000x3000 pixel.",
    ERROR_COVER_MAX_6000X6000: "Risoluzione massima 6000x6000 pixel.",
  },
  nl: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Geen videostream gevonden in het bestand.",
    ERROR_VEVO_NOT_STEREO: "Audio moet stereo (2 kanalen) zijn.",
    ERROR_COVER_MUST_BE_SQUARE: "Omslagafbeelding moet vierkant zijn.",
    ERROR_COVER_MIN_3000X3000: "Minimumresolutie is 3000x3000 pixels.",
    ERROR_COVER_MAX_6000X6000: "Maximumresolutie is 6000x6000 pixels.",
  },
  pl: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Nie znaleziono strumienia wideo w pliku.",
    ERROR_VEVO_NOT_STEREO: "Audio musi być stereo (2 kanały).",
    ERROR_COVER_MUST_BE_SQUARE: "Okładka musi być kwadratowa.",
    ERROR_COVER_MIN_3000X3000: "Minimalna rozdzielczość to 3000x3000 pikseli.",
    ERROR_COVER_MAX_6000X6000: "Maksymalna rozdzielczość to 6000x6000 pikseli.",
  },
  sv: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Ingen videoström hittades i filen.",
    ERROR_VEVO_NOT_STEREO: "Ljud måste vara stereo (2 kanaler).",
    ERROR_COVER_MUST_BE_SQUARE: "Omslagsbilden måste vara kvadratisk.",
    ERROR_COVER_MIN_3000X3000: "Minsta upplösning är 3000x3000 pixlar.",
    ERROR_COVER_MAX_6000X6000: "Högsta upplösning är 6000x6000 pixlar.",
  },
  tr: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Dosyada video akışı bulunamadı.",
    ERROR_VEVO_NOT_STEREO: "Ses stereo (2 kanal) olmalıdır.",
    ERROR_COVER_MUST_BE_SQUARE: "Kapak görseli kare olmalıdır.",
    ERROR_COVER_MIN_3000X3000: "Minimum çözünürlük 3000x3000 piksel.",
    ERROR_COVER_MAX_6000X6000: "Maksimum çözünürlük 6000x6000 piksel.",
  },
  uk: {
    ERROR_VEVO_NO_VIDEO_STREAM: "Відеопотік не знайдено у файлі.",
    ERROR_VEVO_NOT_STEREO: "Аудіо має бути стерео (2 канали).",
    ERROR_COVER_MUST_BE_SQUARE: "Обкладинка має бути квадратною.",
    ERROR_COVER_MIN_3000X3000: "Мінімальна роздільна здатність 3000x3000 пікселів.",
    ERROR_COVER_MAX_6000X6000: "Максимальна роздільна здатність 6000x6000 пікселів.",
  },
};

const langs = ['ar','de','es','fr','hi','id','it','ja','ko','nl','pl','pt','ru','sv','th','tr','uk','zh'];
let updated = 0;

for (const lang of langs) {
  const filePath = path.join(dir, `${lang}.ts`);
  if (!fs.existsSync(filePath)) continue;

  let content = fs.readFileSync(filePath, 'utf-8');
  
  if (content.includes('vevoErrors:')) {
    console.log(`SKIP: ${lang}.ts - vevoErrors already exists`);
    continue;
  }
  
  const merged = { ...vevoErrorsEN, ...(overrides[lang] || {}) };
  
  let block = '\n  vevoErrors: {\n';
  for (const [key, val] of Object.entries(merged)) {
    block += `    ${key}: "${val.replace(/"/g, '\\"')}",\n`;
  }
  block += '  },';
  
  // Insert before the placeholder section
  const placeholderIdx = content.indexOf('  placeholder:');
  if (placeholderIdx !== -1) {
    content = content.slice(0, placeholderIdx) + block + '\n  ' + content.slice(placeholderIdx);
  } else {
    const toastIdx = content.indexOf('  toast:');
    if (toastIdx !== -1) {
      content = content.slice(0, toastIdx) + block + '\n  ' + content.slice(toastIdx);
    } else {
      console.log(`WARN: ${lang}.ts - could not find insertion point`);
      continue;
    }
  }
  
  fs.writeFileSync(filePath, content, 'utf-8');
  updated++;
  console.log(`OK: ${lang}.ts`);
}

console.log(`\nUpdated ${updated} files with vevoErrors section`);
