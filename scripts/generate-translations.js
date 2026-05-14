/**
 * Generate translation files for new languages.
 * Run: node scripts/generate-translations.js
 */
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname, "..", "lib", "i18n", "translations");

// New keys to add to ALL existing files + new language files
const newKeys = {
  login: {
    welcomeBack: null, verifyIdentity: null, enterCode: null, signIn: null,
    signingIn: null, email: null, password: null, enterPassword: null,
    rememberDevice: null, chooseMethod: null, authenticatorApp: null,
    recoveryCode: null, emailMethod: null, emailDesc: null, appDesc: null,
    recoveryDesc: null, sendingCode: null, newLocationDetected: null,
    newLocationDesc: null, securityCheck: null, enterAuthCode: null,
    enterRecoveryCode: null, codeSentTo: null, verifying: null, verify: null,
    enterCodePrompt: null, digitsLeft: null, resendCode: null,
    useRecoveryCode: null, back: null, copyright: null, loginFailed: null,
    errorOccurred: null, invalidCode: null, failedSendCode: null, failedResendCode: null,
  },
  profile: { settings: null, signOut: null },
  activity: {
    created: null, updated: null, deleted: null, approved: null,
    rejected: null, loggedIn: null, uploaded: null, statusChange: null,
  },
  time: { justNow: null, minutesAgo: null, hoursAgo: null, daysAgo: null },
};

// Translations for all 20 languages
const translations = {
  vi: {
    login: {
      welcomeBack: "Chào mừng trở lại", verifyIdentity: "Xác minh danh tính", enterCode: "Nhập mã",
      signIn: "Đăng nhập", signingIn: "Đang đăng nhập...", email: "Email", password: "Mật khẩu",
      enterPassword: "Nhập mật khẩu", rememberDevice: "Ghi nhớ thiết bị trong 30 ngày",
      chooseMethod: "Chọn phương thức xác minh để tiếp tục", authenticatorApp: "Ứng dụng xác thực",
      recoveryCode: "Mã khôi phục", emailMethod: "Email",
      emailDesc: "Mã 6 chữ số gửi đến email của bạn.",
      appDesc: "Mã 6 chữ số từ ứng dụng xác thực.", recoveryDesc: "Mã sao lưu khi thiết lập 2FA.",
      sendingCode: "Đang gửi mã...", newLocationDetected: "Phát hiện vị trí mới",
      newLocationDesc: "Vui lòng nhập mã xác minh đã gửi đến email để phê duyệt đăng nhập.",
      securityCheck: "Kiểm tra bảo mật", enterAuthCode: "Nhập mã 6 chữ số từ ứng dụng xác thực",
      enterRecoveryCode: "Nhập mã khôi phục 9 ký tự", codeSentTo: "Mã đã gửi đến",
      verifying: "Đang xác minh...", verify: "Xác minh", enterCodePrompt: "Nhập mã",
      digitsLeft: "chữ số còn lại", resendCode: "Chưa nhận được mã? Gửi lại",
      useRecoveryCode: "Sử dụng mã khôi phục", back: "Quay lại",
      copyright: "Bản quyền đã được bảo hộ.", loginFailed: "Đăng nhập thất bại",
      errorOccurred: "Đã xảy ra lỗi. Vui lòng thử lại.", invalidCode: "Mã xác minh không hợp lệ",
      failedSendCode: "Gửi mã xác minh thất bại", failedResendCode: "Gửi lại mã thất bại",
    },
    profile: { settings: "Cài đặt", signOut: "Đăng xuất" },
    activity: { created: "Đã tạo", updated: "Đã cập nhật", deleted: "Đã xóa", approved: "Đã duyệt",
      rejected: "Từ chối", loggedIn: "Đã đăng nhập", uploaded: "Đã tải lên", statusChange: "Đổi trạng thái" },
    time: { justNow: "Vừa xong", minutesAgo: "{n} phút trước", hoursAgo: "{n} giờ trước", daysAgo: "{n} ngày trước" },
  },
  ja: {
    login: {
      welcomeBack: "おかえりなさい", verifyIdentity: "本人確認", enterCode: "コードを入力",
      signIn: "サインイン", signingIn: "サインイン中...", email: "メール", password: "パスワード",
      enterPassword: "パスワードを入力", rememberDevice: "30日間このデバイスを記憶",
      chooseMethod: "確認方法を選択してください", authenticatorApp: "認証アプリ",
      recoveryCode: "リカバリーコード", emailMethod: "メール",
      emailDesc: "メールに6桁のコードが送信されます。",
      appDesc: "認証アプリの6桁のコードを入力。", recoveryDesc: "2FA設定時に保存したバックアップコード。",
      sendingCode: "コード送信中...", newLocationDetected: "新しい場所が検出されました",
      newLocationDesc: "メールに送信された確認コードを入力してログインを承認してください。",
      securityCheck: "セキュリティチェック", enterAuthCode: "認証アプリの6桁コードを入力",
      enterRecoveryCode: "9文字のリカバリーコードを入力", codeSentTo: "コード送信先",
      verifying: "確認中...", verify: "確認", enterCodePrompt: "コードを入力",
      digitsLeft: "桁残り", resendCode: "コードが届きませんか？再送信",
      useRecoveryCode: "リカバリーコードを使用", back: "戻る",
      copyright: "全著作権所有。", loginFailed: "ログインに失敗しました",
      errorOccurred: "エラーが発生しました。もう一度お試しください。", invalidCode: "無効な確認コード",
      failedSendCode: "確認コードの送信に失敗", failedResendCode: "コードの再送信に失敗",
    },
    profile: { settings: "設定", signOut: "サインアウト" },
    activity: { created: "作成", updated: "更新", deleted: "削除", approved: "承認",
      rejected: "却下", loggedIn: "ログイン", uploaded: "アップロード", statusChange: "ステータス変更" },
    time: { justNow: "たった今", minutesAgo: "{n}分前", hoursAgo: "{n}時間前", daysAgo: "{n}日前" },
  },
  ko: {
    login: {
      welcomeBack: "다시 오신 것을 환영합니다", verifyIdentity: "본인 확인", enterCode: "코드 입력",
      signIn: "로그인", signingIn: "로그인 중...", email: "이메일", password: "비밀번호",
      enterPassword: "비밀번호 입력", rememberDevice: "30일간 이 기기 기억",
      chooseMethod: "인증 방법을 선택하세요", authenticatorApp: "인증 앱",
      recoveryCode: "복구 코드", emailMethod: "이메일",
      emailDesc: "이메일로 6자리 코드가 전송됩니다.",
      appDesc: "인증 앱의 6자리 코드를 입력하세요.", recoveryDesc: "2FA 설정 시 저장한 백업 코드.",
      sendingCode: "코드 전송 중...", newLocationDetected: "새로운 위치 감지",
      newLocationDesc: "이메일로 전송된 인증 코드를 입력하여 로그인을 승인하세요.",
      securityCheck: "보안 확인", enterAuthCode: "인증 앱의 6자리 코드 입력",
      enterRecoveryCode: "9자리 복구 코드 입력", codeSentTo: "코드 전송 대상",
      verifying: "확인 중...", verify: "확인", enterCodePrompt: "코드 입력",
      digitsLeft: "자리 남음", resendCode: "코드를 받지 못하셨나요? 재전송",
      useRecoveryCode: "복구 코드 사용", back: "뒤로",
      copyright: "모든 권리 보유.", loginFailed: "로그인 실패",
      errorOccurred: "오류가 발생했습니다. 다시 시도해주세요.", invalidCode: "잘못된 인증 코드",
      failedSendCode: "인증 코드 전송 실패", failedResendCode: "코드 재전송 실패",
    },
    profile: { settings: "설정", signOut: "로그아웃" },
    activity: { created: "생성됨", updated: "업데이트됨", deleted: "삭제됨", approved: "승인됨",
      rejected: "거부됨", loggedIn: "로그인", uploaded: "업로드됨", statusChange: "상태 변경" },
    time: { justNow: "방금", minutesAgo: "{n}분 전", hoursAgo: "{n}시간 전", daysAgo: "{n}일 전" },
  },
  zh: {
    login: {
      welcomeBack: "欢迎回来", verifyIdentity: "验证身份", enterCode: "输入验证码",
      signIn: "登录", signingIn: "登录中...", email: "邮箱", password: "密码",
      enterPassword: "输入密码", rememberDevice: "记住此设备30天",
      chooseMethod: "选择验证方式继续", authenticatorApp: "验证器应用",
      recoveryCode: "恢复代码", emailMethod: "邮箱",
      emailDesc: "6位验证码将发送到您的邮箱。",
      appDesc: "输入验证器应用中的6位代码。", recoveryDesc: "设置2FA时保存的备用代码。",
      sendingCode: "发送中...", newLocationDetected: "检测到新位置",
      newLocationDesc: "请输入发送到邮箱的验证码以批准此登录。",
      securityCheck: "安全检查", enterAuthCode: "输入验证器应用的6位代码",
      enterRecoveryCode: "输入9位恢复代码", codeSentTo: "验证码已发送至",
      verifying: "验证中...", verify: "验证", enterCodePrompt: "输入验证码",
      digitsLeft: "位剩余", resendCode: "没收到验证码？重新发送",
      useRecoveryCode: "使用恢复代码", back: "返回",
      copyright: "保留所有权利。", loginFailed: "登录失败",
      errorOccurred: "发生错误，请重试。", invalidCode: "验证码无效",
      failedSendCode: "发送验证码失败", failedResendCode: "重新发送失败",
    },
    profile: { settings: "设置", signOut: "退出登录" },
    activity: { created: "已创建", updated: "已更新", deleted: "已删除", approved: "已批准",
      rejected: "已拒绝", loggedIn: "已登录", uploaded: "已上传", statusChange: "状态变更" },
    time: { justNow: "刚刚", minutesAgo: "{n}分钟前", hoursAgo: "{n}小时前", daysAgo: "{n}天前" },
  },
  fr: {
    login: {
      welcomeBack: "Bon retour", verifyIdentity: "Vérifier l'identité", enterCode: "Entrer le code",
      signIn: "Se connecter", signingIn: "Connexion...", email: "E-mail", password: "Mot de passe",
      enterPassword: "Entrez votre mot de passe", rememberDevice: "Se souvenir de cet appareil pendant 30 jours",
      chooseMethod: "Choisissez une méthode de vérification", authenticatorApp: "Application d'authentification",
      recoveryCode: "Code de récupération", emailMethod: "E-mail",
      emailDesc: "Un code à 6 chiffres envoyé à votre e-mail.",
      appDesc: "Un code à 6 chiffres de votre application.", recoveryDesc: "Un code de sauvegarde enregistré lors de la configuration 2FA.",
      sendingCode: "Envoi du code...", newLocationDetected: "Nouvel emplacement détecté",
      newLocationDesc: "Entrez le code envoyé à votre e-mail pour approuver cette connexion.",
      securityCheck: "Vérification de sécurité", enterAuthCode: "Entrez le code à 6 chiffres de votre application",
      enterRecoveryCode: "Entrez un code de récupération de 9 caractères", codeSentTo: "Code envoyé à",
      verifying: "Vérification...", verify: "Vérifier", enterCodePrompt: "Entrer le code",
      digitsLeft: "chiffres restants", resendCode: "Pas reçu ? Renvoyer",
      useRecoveryCode: "Utiliser un code de récupération", back: "Retour",
      copyright: "Tous droits réservés.", loginFailed: "Échec de connexion",
      errorOccurred: "Une erreur est survenue. Veuillez réessayer.", invalidCode: "Code de vérification invalide",
      failedSendCode: "Échec de l'envoi du code", failedResendCode: "Échec du renvoi",
    },
    profile: { settings: "Paramètres", signOut: "Déconnexion" },
    activity: { created: "Créé", updated: "Mis à jour", deleted: "Supprimé", approved: "Approuvé",
      rejected: "Rejeté", loggedIn: "Connecté", uploaded: "Téléversé", statusChange: "Changement de statut" },
    time: { justNow: "À l'instant", minutesAgo: "il y a {n}min", hoursAgo: "il y a {n}h", daysAgo: "il y a {n}j" },
  },
  es: {
    login: {
      welcomeBack: "Bienvenido de nuevo", verifyIdentity: "Verificar identidad", enterCode: "Ingresar código",
      signIn: "Iniciar sesión", signingIn: "Iniciando sesión...", email: "Correo", password: "Contraseña",
      enterPassword: "Ingrese su contraseña", rememberDevice: "Recordar este dispositivo por 30 días",
      chooseMethod: "Elija un método de verificación", authenticatorApp: "App de autenticación",
      recoveryCode: "Código de recuperación", emailMethod: "Correo",
      emailDesc: "Un código de 6 dígitos enviado a su correo.",
      appDesc: "Un código de 6 dígitos de su app de autenticación.", recoveryDesc: "Un código de respaldo guardado al configurar 2FA.",
      sendingCode: "Enviando código...", newLocationDetected: "Nueva ubicación detectada",
      newLocationDesc: "Ingrese el código enviado a su correo para aprobar este inicio de sesión.",
      securityCheck: "Verificación de seguridad", enterAuthCode: "Ingrese el código de 6 dígitos de su app",
      enterRecoveryCode: "Ingrese un código de recuperación de 9 caracteres", codeSentTo: "Código enviado a",
      verifying: "Verificando...", verify: "Verificar", enterCodePrompt: "Ingresar código",
      digitsLeft: "dígitos restantes", resendCode: "¿No recibió el código? Reenviar",
      useRecoveryCode: "Usar código de recuperación", back: "Atrás",
      copyright: "Todos los derechos reservados.", loginFailed: "Error de inicio de sesión",
      errorOccurred: "Ocurrió un error. Intente de nuevo.", invalidCode: "Código de verificación inválido",
      failedSendCode: "Error al enviar código", failedResendCode: "Error al reenviar",
    },
    profile: { settings: "Configuración", signOut: "Cerrar sesión" },
    activity: { created: "Creado", updated: "Actualizado", deleted: "Eliminado", approved: "Aprobado",
      rejected: "Rechazado", loggedIn: "Sesión iniciada", uploaded: "Subido", statusChange: "Cambio de estado" },
    time: { justNow: "Ahora", minutesAgo: "hace {n}min", hoursAgo: "hace {n}h", daysAgo: "hace {n}d" },
  },
  de: {
    login: {
      welcomeBack: "Willkommen zurück", verifyIdentity: "Identität bestätigen", enterCode: "Code eingeben",
      signIn: "Anmelden", signingIn: "Anmeldung...", email: "E-Mail", password: "Passwort",
      enterPassword: "Passwort eingeben", rememberDevice: "Dieses Gerät 30 Tage merken",
      chooseMethod: "Wählen Sie eine Verifizierungsmethode", authenticatorApp: "Authenticator-App",
      recoveryCode: "Wiederherstellungscode", emailMethod: "E-Mail",
      emailDesc: "Ein 6-stelliger Code an Ihre E-Mail.",
      appDesc: "Ein 6-stelliger Code aus Ihrer Authenticator-App.", recoveryDesc: "Ein Backup-Code, den Sie bei der 2FA-Einrichtung gespeichert haben.",
      sendingCode: "Code wird gesendet...", newLocationDetected: "Neuer Standort erkannt",
      newLocationDesc: "Geben Sie den an Ihre E-Mail gesendeten Code ein, um diese Anmeldung zu genehmigen.",
      securityCheck: "Sicherheitsprüfung", enterAuthCode: "6-stelligen Code der Authenticator-App eingeben",
      enterRecoveryCode: "9-stelligen Wiederherstellungscode eingeben", codeSentTo: "Code gesendet an",
      verifying: "Überprüfung...", verify: "Bestätigen", enterCodePrompt: "Code eingeben",
      digitsLeft: "Ziffern übrig", resendCode: "Keinen Code erhalten? Erneut senden",
      useRecoveryCode: "Wiederherstellungscode verwenden", back: "Zurück",
      copyright: "Alle Rechte vorbehalten.", loginFailed: "Anmeldung fehlgeschlagen",
      errorOccurred: "Ein Fehler ist aufgetreten. Bitte versuchen Sie es erneut.", invalidCode: "Ungültiger Verifizierungscode",
      failedSendCode: "Code senden fehlgeschlagen", failedResendCode: "Erneutes Senden fehlgeschlagen",
    },
    profile: { settings: "Einstellungen", signOut: "Abmelden" },
    activity: { created: "Erstellt", updated: "Aktualisiert", deleted: "Gelöscht", approved: "Genehmigt",
      rejected: "Abgelehnt", loggedIn: "Angemeldet", uploaded: "Hochgeladen", statusChange: "Statusänderung" },
    time: { justNow: "Gerade", minutesAgo: "vor {n}Min", hoursAgo: "vor {n}Std", daysAgo: "vor {n}T" },
  },
  pt: {
    login: {
      welcomeBack: "Bem-vindo de volta", verifyIdentity: "Verificar identidade", enterCode: "Inserir código",
      signIn: "Entrar", signingIn: "Entrando...", email: "E-mail", password: "Senha",
      enterPassword: "Digite sua senha", rememberDevice: "Lembrar este dispositivo por 30 dias",
      chooseMethod: "Escolha um método de verificação", authenticatorApp: "App autenticador",
      recoveryCode: "Código de recuperação", emailMethod: "E-mail",
      emailDesc: "Um código de 6 dígitos enviado ao seu e-mail.",
      appDesc: "Um código de 6 dígitos do seu app autenticador.", recoveryDesc: "Um código de backup salvo ao configurar 2FA.",
      sendingCode: "Enviando código...", newLocationDetected: "Nova localização detectada",
      newLocationDesc: "Digite o código enviado ao seu e-mail para aprovar este login.",
      securityCheck: "Verificação de segurança", enterAuthCode: "Digite o código de 6 dígitos do seu app",
      enterRecoveryCode: "Digite um código de recuperação de 9 caracteres", codeSentTo: "Código enviado para",
      verifying: "Verificando...", verify: "Verificar", enterCodePrompt: "Inserir código",
      digitsLeft: "dígitos restantes", resendCode: "Não recebeu? Reenviar",
      useRecoveryCode: "Usar código de recuperação", back: "Voltar",
      copyright: "Todos os direitos reservados.", loginFailed: "Falha no login",
      errorOccurred: "Ocorreu um erro. Tente novamente.", invalidCode: "Código de verificação inválido",
      failedSendCode: "Falha ao enviar código", failedResendCode: "Falha ao reenviar",
    },
    profile: { settings: "Configurações", signOut: "Sair" },
    activity: { created: "Criado", updated: "Atualizado", deleted: "Excluído", approved: "Aprovado",
      rejected: "Rejeitado", loggedIn: "Logado", uploaded: "Enviado", statusChange: "Mudança de status" },
    time: { justNow: "Agora", minutesAgo: "há {n}min", hoursAgo: "há {n}h", daysAgo: "há {n}d" },
  },
  th: {
    login: {
      welcomeBack: "ยินดีต้อนรับกลับ", verifyIdentity: "ยืนยันตัวตน", enterCode: "ใส่รหัส",
      signIn: "เข้าสู่ระบบ", signingIn: "กำลังเข้าสู่ระบบ...", email: "อีเมล", password: "รหัสผ่าน",
      enterPassword: "ใส่รหัสผ่าน", rememberDevice: "จำอุปกรณ์นี้ 30 วัน",
      chooseMethod: "เลือกวิธีการยืนยันเพื่อดำเนินการต่อ", authenticatorApp: "แอปยืนยันตัวตน",
      recoveryCode: "รหัสกู้คืน", emailMethod: "อีเมล",
      emailDesc: "รหัส 6 หลักจะถูกส่งไปยังอีเมลของคุณ",
      appDesc: "รหัส 6 หลักจากแอปยืนยันตัวตน", recoveryDesc: "รหัสสำรองที่บันทึกไว้ตอนตั้งค่า 2FA",
      sendingCode: "กำลังส่งรหัส...", newLocationDetected: "ตรวจพบตำแหน่งใหม่",
      newLocationDesc: "กรุณาใส่รหัสยืนยันที่ส่งไปยังอีเมลเพื่ออนุมัติการเข้าสู่ระบบ",
      securityCheck: "ตรวจสอบความปลอดภัย", enterAuthCode: "ใส่รหัส 6 หลักจากแอปยืนยันตัวตน",
      enterRecoveryCode: "ใส่รหัสกู้คืน 9 ตัวอักษร", codeSentTo: "ส่งรหัสไปที่",
      verifying: "กำลังยืนยัน...", verify: "ยืนยัน", enterCodePrompt: "ใส่รหัส",
      digitsLeft: "หลักที่เหลือ", resendCode: "ไม่ได้รับรหัส? ส่งอีกครั้ง",
      useRecoveryCode: "ใช้รหัสกู้คืนแทน", back: "กลับ",
      copyright: "สงวนลิขสิทธิ์", loginFailed: "เข้าสู่ระบบล้มเหลว",
      errorOccurred: "เกิดข้อผิดพลาด กรุณาลองอีกครั้ง", invalidCode: "รหัสยืนยันไม่ถูกต้อง",
      failedSendCode: "ส่งรหัสยืนยันล้มเหลว", failedResendCode: "ส่งรหัสอีกครั้งล้มเหลว",
    },
    profile: { settings: "ตั้งค่า", signOut: "ออกจากระบบ" },
    activity: { created: "สร้างแล้ว", updated: "อัปเดตแล้ว", deleted: "ลบแล้ว", approved: "อนุมัติแล้ว",
      rejected: "ปฏิเสธแล้ว", loggedIn: "เข้าสู่ระบบแล้ว", uploaded: "อัปโหลดแล้ว", statusChange: "เปลี่ยนสถานะ" },
    time: { justNow: "เมื่อกี้", minutesAgo: "{n}นาทีที่แล้ว", hoursAgo: "{n}ชม.ที่แล้ว", daysAgo: "{n}วันที่แล้ว" },
  },
};

// For each existing non-en file, append the new keys
const existingLangs = ["vi", "ja", "ko", "zh", "fr", "es", "de", "pt", "th"];

for (const lang of existingLangs) {
  const filePath = path.join(dir, `${lang}.ts`);
  let content = fs.readFileSync(filePath, "utf8");
  
  const t = translations[lang];
  if (!t) { console.log(`No translations for ${lang}, skipping`); continue; }
  
  // Check if login section already exists
  if (content.includes("login:")) {
    console.log(`${lang}.ts already has login section, skipping`);
    continue;
  }
  
  // Insert before the statuses section
  const insertPoint = content.indexOf("  statuses:");
  if (insertPoint === -1) { console.log(`Cannot find statuses in ${lang}.ts`); continue; }
  
  const newSection = `  login: ${JSON.stringify(t.login, null, 4).replace(/\n/g, "\n  ")},

  profile: ${JSON.stringify(t.profile, null, 4).replace(/\n/g, "\n  ")},

  activity: ${JSON.stringify(t.activity, null, 4).replace(/\n/g, "\n  ")},

  time: ${JSON.stringify(t.time, null, 4).replace(/\n/g, "\n  ")},

  `;
  
  content = content.slice(0, insertPoint) + newSection + content.slice(insertPoint);
  fs.writeFileSync(filePath, content, "utf8");
  console.log(`Updated ${lang}.ts`);
}

console.log("\nDone! Run TypeScript to verify.");
