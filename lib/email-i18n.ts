/**
 * Email Translation Dictionary
 * Centralized multi-language strings for all email templates.
 * Replaces binary isVi checks with full 20-language support.
 */

export interface EmailStrings {
  // 2FA
  twoFactor: {
    subject: string; title: string; desc: (method: string) => string;
    expires: string; ignore: string; plainText: (code: string) => string;
  };
  // Security Alert
  security: {
    subject: (reason: string) => string; desc: string;
    device: string; ip: string; location: string; time: string; unknown: string;
    action: string; btn: string;
  };
  // Suspicious Login
  suspicious: {
    subject: string; title: string; desc: string;
    device: string; ip: string; location: string; time: string; unknown: string;
    action: string; btn: string;
  };
  // Welcome
  welcome: {
    subject: string; title: (name: string) => string; desc: string;
    btn: string; help: string;
  };
  // Release Approved
  releaseApproved: {
    subject: (t: string) => string; title: string;
    desc: (t: string) => string; btn: string;
  };
  // Release Denied
  releaseDenied: {
    subject: (t: string) => string; title: string;
    desc: (t: string) => string; reasonLabel: string;
    instruction: string; btn: string;
  };
  // Release Delivered
  releaseDelivered: {
    subject: (t: string) => string; title: string;
    desc: (t: string, n: number) => string; btn: string;
  };
  // Milestone
  milestone: {
    subject: (t: string, m: string) => string; title: string;
    desc: (t: string, m: string) => string; btn: string;
  };
  // Review Request
  reviewRequest: {
    subject: (t: string, a: string) => string; title: string;
    desc: (t: string, a: string) => string; btn: string;
  };
  // Royalty
  royalty: {
    subject: (p: string, period: string) => string; title: string;
    desc: string; platformLabel: string; periodLabel: string;
    revenueLabel: string; btn: string;
  };
}

const en: EmailStrings = {
  twoFactor: {
    subject: "BeAlpha — Your verification code",
    title: "Verification Code",
    desc: (method) => `Use this code to complete your ${method === "login" ? "sign-in" : "verification"}:`,
    expires: "This code expires in <strong>10 minutes</strong>. Do not share it with anyone, including support staff.",
    ignore: "If you didn't request this, ignore this email. Your account is safe.",
    plainText: (code) => `Your BeAlpha verification code is: ${code}. It expires in 10 minutes.`,
  },
  security: {
    subject: (reason) => `BeAlpha Security Alert — ${reason}`,
    desc: "Our security system detected unusual activity on your account. A session was accessed from an unrecognized device or location.",
    device: "Device / Browser", ip: "IP", location: "Location", time: "Time", unknown: "Unknown",
    action: 'If this was you, you can safely ignore this alert. Otherwise, your credentials may be compromised — <strong style="color:#dc2626;">change your password immediately</strong>.',
    btn: "Secure My Account",
  },
  suspicious: {
    subject: "BeAlpha — New sign-in from unrecognized device",
    title: "New Sign-in Detected",
    desc: "Your account was accessed from a new device or location. If this was you, no action is needed.",
    device: "Device", ip: "IP", location: "Location", time: "Time", unknown: "Unknown",
    action: "If you didn't sign in, someone may have your password. Secure your account now.",
    btn: "Review Activity",
  },
  welcome: {
    subject: "Welcome to BeAlpha Music!",
    title: (name) => `Welcome, ${name}!`,
    desc: "Your BeAlpha Music account is ready. Start distributing your music to 150+ streaming platforms worldwide.",
    btn: "Go to Dashboard",
    help: "Need help? Contact our support team anytime.",
  },
  releaseApproved: {
    subject: (t) => `Release Approved — "${t}"`,
    title: "Release Approved",
    desc: (t) => `Great news! Your release <strong style="color:#000;">"${t}"</strong> has been approved and is ready for distribution.`,
    btn: "View in Dashboard",
  },
  releaseDenied: {
    subject: (t) => `Release Denied — "${t}"`,
    title: "Release Denied",
    desc: (t) => `Unfortunately, your release <strong style="color:#000;">"${t}"</strong> was not approved.`,
    reasonLabel: "Reason:", instruction: "Please review and resubmit. If you have questions, contact support.",
    btn: "Review Release",
  },
  releaseDelivered: {
    subject: (t) => `Delivery Successful — "${t}"`,
    title: "Release Delivered",
    desc: (t, n) => `Your release <strong style="color:#000;">"${t}"</strong> has been successfully delivered to ${n} platforms (Spotify, Apple Music, etc.).`,
    btn: "View in Dashboard",
  },
  milestone: {
    subject: (t, m) => `Congrats! "${t}" reached ${m} streams!`,
    title: "New Milestone",
    desc: (t, m) => `Amazing! Your release <strong style="color:#000;">"${t}"</strong> just hit a massive milestone: <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span>.`,
    btn: "View Analytics",
  },
  reviewRequest: {
    subject: (t, a) => `Action Required: "${t}" by ${a}`,
    title: "New Release Review",
    desc: (t, a) => `The release <strong style="color:#000;">"${t}"</strong> by <strong style="color:#000;">${a}</strong> has been submitted and is waiting for your review.`,
    btn: "Review Now",
  },
  royalty: {
    subject: (p, period) => `New Royalty Report — ${p} ${period}`,
    title: "New Royalty Report", desc: "A new royalty report has been processed:",
    platformLabel: "Platform:", periodLabel: "Period:", revenueLabel: "Revenue:",
    btn: "View Report",
  },
};

const vi: EmailStrings = {
  twoFactor: {
    subject: "BeAlpha — Mã xác minh của bạn",
    title: "Mã Xác Minh",
    desc: (method) => `Sử dụng mã này để hoàn tất ${method === "login" ? "đăng nhập" : "xác minh"}:`,
    expires: "Mã này sẽ hết hạn trong <strong>10 phút</strong>. Không chia sẻ mã với bất kỳ ai, kể cả nhân viên hỗ trợ.",
    ignore: "Nếu bạn không yêu cầu mã này, vui lòng bỏ qua email. Tài khoản của bạn vẫn an toàn.",
    plainText: (code) => `Mã xác minh BeAlpha của bạn là: ${code}. Mã sẽ hết hạn sau 10 phút.`,
  },
  security: {
    subject: (reason) => `Cảnh báo bảo mật BeAlpha — ${reason}`,
    desc: "Hệ thống bảo mật của chúng tôi phát hiện hoạt động bất thường trên tài khoản của bạn. Một phiên đăng nhập đã được truy cập từ thiết bị hoặc vị trí không xác định.",
    device: "Thiết bị / Trình duyệt", ip: "IP", location: "Vị trí", time: "Thời gian", unknown: "Không rõ",
    action: 'Nếu đây là bạn, bạn có thể bỏ qua cảnh báo này một cách an toàn. Ngược lại, thông tin đăng nhập của bạn có thể đã bị lộ — <strong style="color:#dc2626;">hãy đổi mật khẩu ngay lập tức</strong>.',
    btn: "Bảo Mật Tài Khoản",
  },
  suspicious: {
    subject: "BeAlpha — Đăng nhập mới từ thiết bị lạ",
    title: "Phát hiện đăng nhập mới",
    desc: "Tài khoản của bạn vừa được truy cập từ một thiết bị hoặc vị trí mới. Nếu đây là bạn, không cần hành động gì thêm.",
    device: "Thiết bị", ip: "IP", location: "Vị trí", time: "Thời gian", unknown: "Không rõ",
    action: "Nếu bạn không thực hiện đăng nhập này, có thể ai đó đã có mật khẩu của bạn. Hãy bảo vệ tài khoản ngay bây giờ.",
    btn: "Kiểm tra hoạt động",
  },
  welcome: {
    subject: "Chào mừng đến với BeAlpha Music!",
    title: (name) => `Chào mừng, ${name}!`,
    desc: "Tài khoản BeAlpha Music của bạn đã sẵn sàng. Bắt đầu phân phối âm nhạc của bạn tới hơn 150 nền tảng phát trực tuyến trên toàn thế giới.",
    btn: "Đi tới Dashboard", help: "Cần trợ giúp? Liên hệ với nhóm hỗ trợ của chúng tôi bất cứ lúc nào.",
  },
  releaseApproved: {
    subject: (t) => `Phát hành được duyệt — "${t}"`, title: "Bản phát hành đã được duyệt",
    desc: (t) => `Tin vui! Bản phát hành <strong style="color:#000;">"${t}"</strong> của bạn đã được duyệt và sẵn sàng để phân phối.`,
    btn: "Xem trên Dashboard",
  },
  releaseDenied: {
    subject: (t) => `Phát hành bị từ chối — "${t}"`, title: "Bản phát hành bị từ chối",
    desc: (t) => `Rất tiếc, sản phẩm <strong style="color:#000;">"${t}"</strong> của bạn đã không được duyệt.`,
    reasonLabel: "Lý do:", instruction: "Vui lòng kiểm tra lại và nộp lại. Nếu có thắc mắc, hãy liên hệ đội ngũ hỗ trợ.",
    btn: "Kiểm tra sản phẩm",
  },
  releaseDelivered: {
    subject: (t) => `Phân phối thành công — "${t}"`, title: "Bản phát hành đã được phân phối",
    desc: (t, n) => `Bản phát hành <strong style="color:#000;">"${t}"</strong> của bạn đã được phân phối thành công tới ${n} nền tảng (Spotify, Apple Music, v.v.).`,
    btn: "Xem trên Dashboard",
  },
  milestone: {
    subject: (t, m) => `Chúc mừng! "${t}" đạt mốc ${m} streams!`, title: "Thành tích mới",
    desc: (t, m) => `Tuyệt vời! Bản phát hành <strong style="color:#000;">"${t}"</strong> của bạn vừa đạt một cột mốc khủng: <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span>.`,
    btn: "Xem báo cáo",
  },
  reviewRequest: {
    subject: (t, a) => `Chờ duyệt: "${t}" từ ${a}`, title: "Bản phát hành mới cần duyệt",
    desc: (t, a) => `Bản phát hành <strong style="color:#000;">"${t}"</strong> của nghệ sĩ <strong style="color:#000;">${a}</strong> vừa được nộp lên hệ thống và đang chờ bạn kiểm duyệt.`,
    btn: "Kiểm duyệt ngay",
  },
  royalty: {
    subject: (p, period) => `Báo cáo doanh thu — ${p} ${period}`, title: "Báo Cáo Doanh Thu Mới",
    desc: "Một báo cáo doanh thu mới đã được xử lý:",
    platformLabel: "Nền tảng:", periodLabel: "Kỳ báo cáo:", revenueLabel: "Doanh thu:",
    btn: "Xem báo cáo",
  },
};

// Japanese
const ja: EmailStrings = {
  twoFactor: { subject: "BeAlpha — 認証コード", title: "認証コード", desc: (m) => `${m === "login" ? "ログイン" : "認証"}を完了するためにこのコードを使用してください：`, expires: "このコードは<strong>10分</strong>で期限切れとなります。サポートスタッフを含め、誰とも共有しないでください。", ignore: "このリクエストに覚えがない場合は、このメールを無視してください。アカウントは安全です。", plainText: (c) => `BeAlpha認証コード: ${c}。10分で期限切れとなります。` },
  security: { subject: (r) => `BeAlpha セキュリティ警告 — ${r}`, desc: "セキュリティシステムがアカウントの異常なアクティビティを検出しました。", device: "デバイス / ブラウザ", ip: "IP", location: "場所", time: "日時", unknown: "不明", action: 'これがご本人であれば、この警告は無視して構いません。そうでなければ、認証情報が漏洩した可能性があります — <strong style="color:#dc2626;">直ちにパスワードを変更してください</strong>。', btn: "アカウントを保護" },
  suspicious: { subject: "BeAlpha — 不明なデバイスからの新しいログイン", title: "新しいログインを検出", desc: "新しいデバイスまたは場所からアカウントにアクセスがありました。", device: "デバイス", ip: "IP", location: "場所", time: "日時", unknown: "不明", action: "ログインに覚えがない場合、パスワードが漏洩した可能性があります。", btn: "アクティビティを確認" },
  welcome: { subject: "BeAlpha Musicへようこそ！", title: (n) => `ようこそ、${n}さん！`, desc: "BeAlpha Musicアカウントの準備が整いました。150以上のストリーミングプラットフォームへの音楽配信を始めましょう。", btn: "ダッシュボードへ", help: "ご不明な点がございましたら、サポートチームまでお問い合わせください。" },
  releaseApproved: { subject: (t) => `リリース承認 — 「${t}」`, title: "リリース承認済み", desc: (t) => `朗報です！リリース<strong style="color:#000;">「${t}」</strong>が承認され、配信の準備が整いました。`, btn: "ダッシュボードで確認" },
  releaseDenied: { subject: (t) => `リリース却下 — 「${t}」`, title: "リリース却下", desc: (t) => `残念ながら、リリース<strong style="color:#000;">「${t}」</strong>は承認されませんでした。`, reasonLabel: "理由:", instruction: "内容を確認の上、再提出してください。", btn: "リリースを確認" },
  releaseDelivered: { subject: (t) => `配信完了 — 「${t}」`, title: "リリース配信完了", desc: (t, n) => `リリース<strong style="color:#000;">「${t}」</strong>が${n}プラットフォームに正常に配信されました。`, btn: "ダッシュボードで確認" },
  milestone: { subject: (t, m) => `おめでとう！「${t}」が${m}ストリーム達成！`, title: "新しいマイルストーン", desc: (t, m) => `素晴らしい！リリース<strong style="color:#000;">「${t}」</strong>が<span style="color:#2563eb;font-weight:bold;font-size:18px;">${m}ストリーム</span>を達成しました。`, btn: "分析を見る" },
  reviewRequest: { subject: (t, a) => `レビュー依頼:「${t}」- ${a}`, title: "新しいリリースレビュー", desc: (t, a) => `<strong style="color:#000;">${a}</strong>のリリース<strong style="color:#000;">「${t}」</strong>が提出され、レビューを待っています。`, btn: "今すぐレビュー" },
  royalty: { subject: (p, per) => `新しいロイヤリティレポート — ${p} ${per}`, title: "新しいロイヤリティレポート", desc: "新しいロイヤリティレポートが処理されました：", platformLabel: "プラットフォーム:", periodLabel: "期間:", revenueLabel: "収益:", btn: "レポートを見る" },
};

// Korean
const ko: EmailStrings = {
  twoFactor: { subject: "BeAlpha — 인증 코드", title: "인증 코드", desc: (m) => `${m === "login" ? "로그인" : "인증"}을 완료하려면 이 코드를 사용하세요:`, expires: "이 코드는 <strong>10분</strong> 후 만료됩니다. 지원팀을 포함하여 누구에게도 공유하지 마세요.", ignore: "본인이 요청하지 않았다면 이 이메일을 무시하세요.", plainText: (c) => `BeAlpha 인증 코드: ${c}. 10분 후 만료됩니다.` },
  security: { subject: (r) => `BeAlpha 보안 알림 — ${r}`, desc: "보안 시스템이 계정의 비정상적인 활동을 감지했습니다.", device: "기기 / 브라우저", ip: "IP", location: "위치", time: "시간", unknown: "알 수 없음", action: '본인이라면 이 알림을 무시해도 됩니다. 그렇지 않다면 — <strong style="color:#dc2626;">즉시 비밀번호를 변경하세요</strong>.', btn: "계정 보호" },
  suspicious: { subject: "BeAlpha — 새 기기에서 로그인", title: "새 로그인 감지", desc: "새로운 기기 또는 위치에서 계정에 접근했습니다.", device: "기기", ip: "IP", location: "위치", time: "시간", unknown: "알 수 없음", action: "본인이 로그인하지 않았다면 비밀번호가 유출되었을 수 있습니다.", btn: "활동 검토" },
  welcome: { subject: "BeAlpha Music에 오신 것을 환영합니다!", title: (n) => `환영합니다, ${n}님!`, desc: "BeAlpha Music 계정이 준비되었습니다. 전 세계 150개 이상의 스트리밍 플랫폼에 음악을 배포하세요.", btn: "대시보드로 이동", help: "도움이 필요하시면 지원팀에 문의하세요." },
  releaseApproved: { subject: (t) => `릴리스 승인 — "${t}"`, title: "릴리스 승인됨", desc: (t) => `좋은 소식입니다! 릴리스 <strong style="color:#000;">"${t}"</strong>가 승인되어 배포 준비가 완료되었습니다.`, btn: "대시보드에서 보기" },
  releaseDenied: { subject: (t) => `릴리스 거부 — "${t}"`, title: "릴리스 거부됨", desc: (t) => `안타깝게도 릴리스 <strong style="color:#000;">"${t}"</strong>가 승인되지 않았습니다.`, reasonLabel: "사유:", instruction: "검토 후 다시 제출해 주세요.", btn: "릴리스 검토" },
  releaseDelivered: { subject: (t) => `배포 완료 — "${t}"`, title: "릴리스 배포 완료", desc: (t, n) => `릴리스 <strong style="color:#000;">"${t}"</strong>가 ${n}개 플랫폼에 성공적으로 배포되었습니다.`, btn: "대시보드에서 보기" },
  milestone: { subject: (t, m) => `축하합니다! "${t}" ${m} 스트림 달성!`, title: "새 마일스톤", desc: (t, m) => `대단해요! 릴리스 <strong style="color:#000;">"${t}"</strong>가 <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} 스트림</span>을 달성했습니다.`, btn: "분석 보기" },
  reviewRequest: { subject: (t, a) => `검토 필요: "${t}" - ${a}`, title: "새 릴리스 검토", desc: (t, a) => `<strong style="color:#000;">${a}</strong>의 릴리스 <strong style="color:#000;">"${t}"</strong>가 제출되어 검토를 기다리고 있습니다.`, btn: "지금 검토" },
  royalty: { subject: (p, per) => `새 로열티 보고서 — ${p} ${per}`, title: "새 로열티 보고서", desc: "새로운 로열티 보고서가 처리되었습니다:", platformLabel: "플랫폼:", periodLabel: "기간:", revenueLabel: "수익:", btn: "보고서 보기" },
};


// Chinese (Simplified)
const zh: EmailStrings = {
  twoFactor: { subject: "BeAlpha — 您的验证码", title: "验证码", desc: (m) => `请使用此验证码完成您的${m === "login" ? "登录" : "验证"}:`, expires: "此验证码将在<strong>10分钟</strong>后过期。请勿与任何人分享。", ignore: "如果您没有请求此代码，请忽略此邮件。", plainText: (c) => `您的BeAlpha验证码是: ${c}。10分钟后过期。` },
  security: { subject: (r) => `BeAlpha 安全警报 — ${r}`, desc: "我们的安全系统检测到您的帐户有异常活动。", device: "设备/浏览器", ip: "IP", location: "位置", time: "时间", unknown: "未知", action: '如果是您本人操作，请忽略此警报。否则，请—<strong style="color:#dc2626;">立即更改密码</strong>。', btn: "保护我的帐户" },
  suspicious: { subject: "BeAlpha — 来自未知设备的新登录", title: "检测到新登录", desc: "您的帐户最近从新设备或位置被访问。", device: "设备", ip: "IP", location: "位置", time: "时间", unknown: "未知", action: "如果您没有登录，您的密码可能已泄露。", btn: "查看活动" },
  welcome: { subject: "欢迎来到BeAlpha Music！", title: (n) => `欢迎，${n}！`, desc: "您的帐户已准备就绪。开始将您的音乐发行到全球150多个流媒体平台。", btn: "进入控制台", help: "需要帮助？请随时联系我们的支持团队。" },
  releaseApproved: { subject: (t) => `发行已批准 — "${t}"`, title: "发行已批准", desc: (t) => `好消息！您的发行 <strong style="color:#000;">"${t}"</strong> 已获批准，准备分发。`, btn: "在控制台中查看" },
  releaseDenied: { subject: (t) => `发行被拒绝 — "${t}"`, title: "发行被拒绝", desc: (t) => `很抱歉，您的发行 <strong style="color:#000;">"${t}"</strong> 未获批准。`, reasonLabel: "原因:", instruction: "请检查并重新提交。", btn: "查看发行" },
  releaseDelivered: { subject: (t) => `分发成功 — "${t}"`, title: "发行已分发", desc: (t, n) => `您的发行 <strong style="color:#000;">"${t}"</strong> 已成功分发到 ${n} 个平台。`, btn: "在控制台中查看" },
  milestone: { subject: (t, m) => `恭喜！"${t}" 达到 ${m} 次播放！`, title: "新里程碑", desc: (t, m) => `太棒了！您的发行 <strong style="color:#000;">"${t}"</strong> 达到了一个巨大的里程碑: <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} 次播放</span>。`, btn: "查看分析" },
  reviewRequest: { subject: (t, a) => `需要审核: "${t}" - ${a}`, title: "新发行待审核", desc: (t, a) => `<strong style="color:#000;">${a}</strong> 的发行 <strong style="color:#000;">"${t}"</strong> 已提交并等待您的审核。`, btn: "立即审核" },
  royalty: { subject: (p, per) => `新版税报告 — ${p} ${per}`, title: "新版税报告", desc: "新的版税报告已处理:", platformLabel: "平台:", periodLabel: "期间:", revenueLabel: "收入:", btn: "查看报告" },
};

// French
const fr: EmailStrings = {
  twoFactor: { subject: "BeAlpha — Votre code de vérification", title: "Code de vérification", desc: (m) => `Utilisez ce code pour finaliser votre ${m === "login" ? "connexion" : "vérification"} :`, expires: "Ce code expire dans <strong>10 minutes</strong>. Ne le partagez avec personne.", ignore: "Si vous n'avez pas demandé ce code, ignorez cet e-mail.", plainText: (c) => `Votre code BeAlpha est : ${c}. Il expire dans 10 minutes.` },
  security: { subject: (r) => `Alerte de sécurité BeAlpha — ${r}`, desc: "Notre système a détecté une activité inhabituelle sur votre compte.", device: "Appareil/Navigateur", ip: "IP", location: "Lieu", time: "Heure", unknown: "Inconnu", action: 'Si c\'est vous, ignorez cette alerte. Sinon, <strong style="color:#dc2626;">changez votre mot de passe immédiatement</strong>.', btn: "Sécuriser mon compte" },
  suspicious: { subject: "BeAlpha — Nouvelle connexion d'un appareil non reconnu", title: "Nouvelle connexion", desc: "Votre compte a été consulté à partir d'un nouvel appareil ou lieu.", device: "Appareil", ip: "IP", location: "Lieu", time: "Heure", unknown: "Inconnu", action: "Si vous ne vous êtes pas connecté, votre mot de passe est peut-être compromis.", btn: "Examiner l'activité" },
  welcome: { subject: "Bienvenue sur BeAlpha Music !", title: (n) => `Bienvenue, ${n} !`, desc: "Votre compte est prêt. Distribuez votre musique sur plus de 150 plateformes.", btn: "Aller au tableau de bord", help: "Besoin d'aide ? Contactez notre équipe d'assistance." },
  releaseApproved: { subject: (t) => `Sortie approuvée — "${t}"`, title: "Sortie approuvée", desc: (t) => `Bonne nouvelle ! Votre sortie <strong style="color:#000;">"${t}"</strong> a été approuvée.`, btn: "Voir dans le tableau de bord" },
  releaseDenied: { subject: (t) => `Sortie refusée — "${t}"`, title: "Sortie refusée", desc: (t) => `Malheureusement, votre sortie <strong style="color:#000;">"${t}"</strong> n'a pas été approuvée.`, reasonLabel: "Raison :", instruction: "Veuillez vérifier et soumettre à nouveau.", btn: "Examiner la sortie" },
  releaseDelivered: { subject: (t) => `Livraison réussie — "${t}"`, title: "Sortie livrée", desc: (t, n) => `Votre sortie <strong style="color:#000;">"${t}"</strong> a été livrée avec succès à ${n} plateformes.`, btn: "Voir dans le tableau de bord" },
  milestone: { subject: (t, m) => `Félicitations ! "${t}" a atteint ${m} streams !`, title: "Nouveau jalon", desc: (t, m) => `Incroyable ! Votre sortie <strong style="color:#000;">"${t}"</strong> a atteint <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span>.`, btn: "Voir les analyses" },
  reviewRequest: { subject: (t, a) => `Action requise : "${t}" par ${a}`, title: "Nouvelle sortie à examiner", desc: (t, a) => `La sortie <strong style="color:#000;">"${t}"</strong> par <strong style="color:#000;">${a}</strong> attend votre examen.`, btn: "Examiner maintenant" },
  royalty: { subject: (p, per) => `Nouveau rapport de redevances — ${p} ${per}`, title: "Nouveau rapport de redevances", desc: "Un nouveau rapport a été traité :", platformLabel: "Plateforme :", periodLabel: "Période :", revenueLabel: "Revenus :", btn: "Voir le rapport" },
};

// Spanish
const es: EmailStrings = {
  twoFactor: { subject: "BeAlpha — Tu código de verificación", title: "Código de verificación", desc: (m) => `Usa este código para completar tu ${m === "login" ? "inicio de sesión" : "verificación"}:`, expires: "Este código expira en <strong>10 minutos</strong>. No lo compartas con nadie.", ignore: "Si no solicitaste este código, ignora este correo.", plainText: (c) => `Tu código BeAlpha es: ${c}. Expira en 10 minutos.` },
  security: { subject: (r) => `Alerta de seguridad BeAlpha — ${r}`, desc: "Nuestro sistema detectó actividad inusual en tu cuenta.", device: "Dispositivo/Navegador", ip: "IP", location: "Ubicación", time: "Hora", unknown: "Desconocido", action: 'Si fuiste tú, ignora esta alerta. Si no, <strong style="color:#dc2626;">cambia tu contraseña inmediatamente</strong>.', btn: "Proteger mi cuenta" },
  suspicious: { subject: "BeAlpha — Nuevo inicio de sesión", title: "Nuevo inicio de sesión", desc: "Se accedió a tu cuenta desde un nuevo dispositivo.", device: "Dispositivo", ip: "IP", location: "Ubicación", time: "Hora", unknown: "Desconocido", action: "Si no iniciaste sesión, alguien podría tener tu contraseña.", btn: "Revisar actividad" },
  welcome: { subject: "¡Bienvenido a BeAlpha Music!", title: (n) => `¡Bienvenido, ${n}!`, desc: "Tu cuenta está lista. Comienza a distribuir tu música a más de 150 plataformas.", btn: "Ir al Dashboard", help: "¿Necesitas ayuda? Contacta a nuestro soporte." },
  releaseApproved: { subject: (t) => `Lanzamiento aprobado — "${t}"`, title: "Lanzamiento aprobado", desc: (t) => `¡Buenas noticias! Tu lanzamiento <strong style="color:#000;">"${t}"</strong> ha sido aprobado.`, btn: "Ver en el Dashboard" },
  releaseDenied: { subject: (t) => `Lanzamiento denegado — "${t}"`, title: "Lanzamiento denegado", desc: (t) => `Lamentablemente, tu lanzamiento <strong style="color:#000;">"${t}"</strong> no fue aprobado.`, reasonLabel: "Motivo:", instruction: "Por favor revisa y vuelve a enviarlo.", btn: "Revisar lanzamiento" },
  releaseDelivered: { subject: (t) => `Entrega exitosa — "${t}"`, title: "Lanzamiento entregado", desc: (t, n) => `Tu lanzamiento <strong style="color:#000;">"${t}"</strong> ha sido entregado a ${n} plataformas.`, btn: "Ver en el Dashboard" },
  milestone: { subject: (t, m) => `¡Felicidades! "${t}" alcanzó ${m} streams`, title: "Nuevo hito", desc: (t, m) => `¡Increíble! Tu lanzamiento <strong style="color:#000;">"${t}"</strong> alcanzó <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span>.`, btn: "Ver analíticas" },
  reviewRequest: { subject: (t, a) => `Acción requerida: "${t}" de ${a}`, title: "Nueva revisión", desc: (t, a) => `El lanzamiento <strong style="color:#000;">"${t}"</strong> de <strong style="color:#000;">${a}</strong> espera tu revisión.`, btn: "Revisar ahora" },
  royalty: { subject: (p, per) => `Nuevo reporte de regalías — ${p} ${per}`, title: "Nuevo reporte de regalías", desc: "Se ha procesado un nuevo reporte:", platformLabel: "Plataforma:", periodLabel: "Período:", revenueLabel: "Ingresos:", btn: "Ver reporte" },
};

// German
const de: EmailStrings = {
  twoFactor: { subject: "BeAlpha — Ihr Bestätigungscode", title: "Bestätigungscode", desc: (m) => `Verwenden Sie diesen Code für Ihre ${m === "login" ? "Anmeldung" : "Bestätigung"}:`, expires: "Dieser Code läuft in <strong>10 Minuten</strong> ab.", ignore: "Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.", plainText: (c) => `Ihr BeAlpha-Code lautet: ${c}. Er läuft in 10 Minuten ab.` },
  security: { subject: (r) => `BeAlpha Sicherheitswarnung — ${r}`, desc: "Wir haben ungewöhnliche Aktivitäten in Ihrem Konto festgestellt.", device: "Gerät/Browser", ip: "IP", location: "Ort", time: "Zeit", unknown: "Unbekannt", action: 'Wenn Sie das waren, können Sie dies ignorieren. Andernfalls <strong style="color:#dc2626;">ändern Sie sofort Ihr Passwort</strong>.', btn: "Mein Konto sichern" },
  suspicious: { subject: "BeAlpha — Neue Anmeldung", title: "Neue Anmeldung", desc: "Auf Ihr Konto wurde von einem neuen Gerät zugegriffen.", device: "Gerät", ip: "IP", location: "Ort", time: "Zeit", unknown: "Unbekannt", action: "Wenn Sie sich nicht angemeldet haben, wurde Ihr Passwort möglicherweise kompromittiert.", btn: "Aktivität überprüfen" },
  welcome: { subject: "Willkommen bei BeAlpha Music!", title: (n) => `Willkommen, ${n}!`, desc: "Ihr Konto ist bereit. Vertreiben Sie Ihre Musik auf über 150 Plattformen.", btn: "Zum Dashboard", help: "Brauchen Sie Hilfe? Kontaktieren Sie unseren Support." },
  releaseApproved: { subject: (t) => `Release genehmigt — "${t}"`, title: "Release genehmigt", desc: (t) => `Gute Nachrichten! Ihr Release <strong style="color:#000;">"${t}"</strong> wurde genehmigt.`, btn: "Im Dashboard ansehen" },
  releaseDenied: { subject: (t) => `Release abgelehnt — "${t}"`, title: "Release abgelehnt", desc: (t) => `Leider wurde Ihr Release <strong style="color:#000;">"${t}"</strong> nicht genehmigt.`, reasonLabel: "Grund:", instruction: "Bitte überprüfen und erneut einreichen.", btn: "Release überprüfen" },
  releaseDelivered: { subject: (t) => `Erfolgreich ausgeliefert — "${t}"`, title: "Release ausgeliefert", desc: (t, n) => `Ihr Release <strong style="color:#000;">"${t}"</strong> wurde erfolgreich an ${n} Plattformen geliefert.`, btn: "Im Dashboard ansehen" },
  milestone: { subject: (t, m) => `Glückwunsch! "${t}" hat ${m} Streams erreicht!`, title: "Neuer Meilenstein", desc: (t, m) => `Unglaublich! Ihr Release <strong style="color:#000;">"${t}"</strong> hat <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span> erreicht.`, btn: "Analysen ansehen" },
  reviewRequest: { subject: (t, a) => `Aktion erforderlich: "${t}" von ${a}`, title: "Neues Release zur Überprüfung", desc: (t, a) => `Das Release <strong style="color:#000;">"${t}"</strong> von <strong style="color:#000;">${a}</strong> wartet auf Ihre Überprüfung.`, btn: "Jetzt überprüfen" },
  royalty: { subject: (p, per) => `Neuer Tantiemenbericht — ${p} ${per}`, title: "Neuer Tantiemenbericht", desc: "Ein neuer Bericht wurde verarbeitet:", platformLabel: "Plattform:", periodLabel: "Zeitraum:", revenueLabel: "Einnahmen:", btn: "Bericht ansehen" },
};

// Portuguese
const pt: EmailStrings = {
  twoFactor: { subject: "BeAlpha — Seu código de verificação", title: "Código de verificação", desc: (m) => `Use este código para concluir seu ${m === "login" ? "login" : "verificação"}:`, expires: "Este código expira em <strong>10 minutos</strong>. Não compartilhe com ninguém.", ignore: "Se você não solicitou, ignore este e-mail.", plainText: (c) => `Seu código BeAlpha é: ${c}. Expira em 10 minutos.` },
  security: { subject: (r) => `Alerta de segurança BeAlpha — ${r}`, desc: "Detectamos atividades incomuns em sua conta.", device: "Dispositivo/Navegador", ip: "IP", location: "Local", time: "Hora", unknown: "Desconhecido", action: 'Se foi você, ignore este alerta. Caso contrário, <strong style="color:#dc2626;">mude sua senha imediatamente</strong>.', btn: "Proteger minha conta" },
  suspicious: { subject: "BeAlpha — Novo login", title: "Novo login", desc: "Sua conta foi acessada por um novo dispositivo.", device: "Dispositivo", ip: "IP", location: "Local", time: "Hora", unknown: "Desconhecido", action: "Se não foi você, alguém pode ter sua senha.", btn: "Revisar atividade" },
  welcome: { subject: "Bem-vindo à BeAlpha Music!", title: (n) => `Bem-vindo, ${n}!`, desc: "Sua conta está pronta. Distribua sua música para mais de 150 plataformas.", btn: "Ir para o Dashboard", help: "Precisa de ajuda? Contate nosso suporte." },
  releaseApproved: { subject: (t) => `Lançamento aprovado — "${t}"`, title: "Lançamento aprovado", desc: (t) => `Boas notícias! Seu lançamento <strong style="color:#000;">"${t}"</strong> foi aprovado.`, btn: "Ver no Dashboard" },
  releaseDenied: { subject: (t) => `Lançamento negado — "${t}"`, title: "Lançamento negado", desc: (t) => `Infelizmente, seu lançamento <strong style="color:#000;">"${t}"</strong> não foi aprovado.`, reasonLabel: "Motivo:", instruction: "Verifique e envie novamente.", btn: "Revisar lançamento" },
  releaseDelivered: { subject: (t) => `Entrega concluída — "${t}"`, title: "Lançamento entregue", desc: (t, n) => `Seu lançamento <strong style="color:#000;">"${t}"</strong> foi entregue a ${n} plataformas.`, btn: "Ver no Dashboard" },
  milestone: { subject: (t, m) => `Parabéns! "${t}" atingiu ${m} streams`, title: "Novo marco", desc: (t, m) => `Incrível! Seu lançamento <strong style="color:#000;">"${t}"</strong> atingiu <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} Streams</span>.`, btn: "Ver análises" },
  reviewRequest: { subject: (t, a) => `Ação necessária: "${t}" de ${a}`, title: "Nova revisão", desc: (t, a) => `O lançamento <strong style="color:#000;">"${t}"</strong> de <strong style="color:#000;">${a}</strong> aguarda sua revisão.`, btn: "Revisar agora" },
  royalty: { subject: (p, per) => `Novo relatório de royalties — ${p} ${per}`, title: "Novo relatório de royalties", desc: "Um novo relatório foi processado:", platformLabel: "Plataforma:", periodLabel: "Período:", revenueLabel: "Receita:", btn: "Ver relatório" },
};

// Thai
const th: EmailStrings = {
  twoFactor: { subject: "BeAlpha — รหัสยืนยันของคุณ", title: "รหัสยืนยัน", desc: (m) => `ใช้รหัสนี้เพื่อทำการ${m === "login" ? "เข้าสู่ระบบ" : "ยืนยัน"}ให้เสร็จสิ้น:`, expires: "รหัสนี้จะหมดอายุใน <strong>10 นาที</strong> ห้ามแชร์กับใคร", ignore: "หากคุณไม่ได้ขอรหัสนี้ โปรดเพิกเฉยต่ออีเมลนี้", plainText: (c) => `รหัสยืนยัน BeAlpha ของคุณคือ: ${c} จะหมดอายุใน 10 นาที` },
  security: { subject: (r) => `แจ้งเตือนความปลอดภัย BeAlpha — ${r}`, desc: "เราตรวจพบกิจกรรมผิดปกติในบัญชีของคุณ", device: "อุปกรณ์/เบราว์เซอร์", ip: "IP", location: "ตำแหน่ง", time: "เวลา", unknown: "ไม่ทราบ", action: 'หากเป็นคุณ โปรดเพิกเฉย แต่ถ้าไม่ใช่ <strong style="color:#dc2626;">โปรดเปลี่ยนรหัสผ่านทันที</strong>', btn: "ปกป้องบัญชีของฉัน" },
  suspicious: { subject: "BeAlpha — การเข้าสู่ระบบใหม่", title: "การเข้าสู่ระบบใหม่", desc: "มีการเข้าถึงบัญชีของคุณจากอุปกรณ์หรือตำแหน่งใหม่", device: "อุปกรณ์", ip: "IP", location: "ตำแหน่ง", time: "เวลา", unknown: "ไม่ทราบ", action: "หากคุณไม่ได้เข้าสู่ระบบ รหัสผ่านของคุณอาจถูกบุกรุก", btn: "ตรวจสอบกิจกรรม" },
  welcome: { subject: "ยินดีต้อนรับสู่ BeAlpha Music!", title: (n) => `ยินดีต้อนรับ ${n}!`, desc: "บัญชีของคุณพร้อมแล้ว เริ่มแจกจ่ายเพลงของคุณไปยังแพลตฟอร์มกว่า 150 แห่ง", btn: "ไปที่แดชบอร์ด", help: "ต้องการความช่วยเหลือ? ติดต่อฝ่ายสนับสนุนของเรา" },
  releaseApproved: { subject: (t) => `ผลงานได้รับการอนุมัติ — "${t}"`, title: "ผลงานได้รับการอนุมัติ", desc: (t) => `ข่าวดี! ผลงาน <strong style="color:#000;">"${t}"</strong> ของคุณได้รับการอนุมัติแล้ว`, btn: "ดูในแดชบอร์ด" },
  releaseDenied: { subject: (t) => `ผลงานถูกปฏิเสธ — "${t}"`, title: "ผลงานถูกปฏิเสธ", desc: (t) => `ขออภัย ผลงาน <strong style="color:#000;">"${t}"</strong> ของคุณไม่ได้รับการอนุมัติ`, reasonLabel: "เหตุผล:", instruction: "โปรดตรวจสอบและส่งอีกครั้ง", btn: "ตรวจสอบผลงาน" },
  releaseDelivered: { subject: (t) => `จัดส่งสำเร็จ — "${t}"`, title: "ผลงานถูกจัดส่งแล้ว", desc: (t, n) => `ผลงาน <strong style="color:#000;">"${t}"</strong> ของคุณถูกจัดส่งไปยัง ${n} แพลตฟอร์มสำเร็จแล้ว`, btn: "ดูในแดชบอร์ด" },
  milestone: { subject: (t, m) => `ยินดีด้วย! "${t}" มียอดสตรีม ${m} ครั้ง!`, title: "ความสำเร็จใหม่", desc: (t, m) => `ยอดเยี่ยม! ผลงาน <strong style="color:#000;">"${t}"</strong> ของคุณมียอดสตรีมถึง <span style="color:#2563eb;font-weight:bold;font-size:18px;">${m} ครั้ง</span> แล้ว`, btn: "ดูการวิเคราะห์" },
  reviewRequest: { subject: (t, a) => `ต้องดำเนินการ: "${t}" โดย ${a}`, title: "การตรวจสอบผลงานใหม่", desc: (t, a) => `ผลงาน <strong style="color:#000;">"${t}"</strong> โดย <strong style="color:#000;">${a}</strong> รอการตรวจสอบจากคุณ`, btn: "ตรวจสอบตอนนี้" },
  royalty: { subject: (p, per) => `รายงานค่าลิขสิทธิ์ใหม่ — ${p} ${per}`, title: "รายงานค่าลิขสิทธิ์ใหม่", desc: "รายงานค่าลิขสิทธิ์ใหม่ได้รับการประมวลผลแล้ว:", platformLabel: "แพลตฟอร์ม:", periodLabel: "รอบบิล:", revenueLabel: "รายได้:", btn: "ดูรายงาน" },
};

// Email Strings Mapping
const EMAIL_STRINGS: Record<string, EmailStrings> = { en, vi, ja, ko, zh, fr, es, de, pt, th };

/**
 * Get email strings for a given language code.
 * Falls back to English for unsupported languages.
 */
export function getEmailStrings(lang: string): EmailStrings {
  const code = lang.toLowerCase().split("-")[0];
  return EMAIL_STRINGS[code] || en;
}

/**
 * Get locale string for date formatting based on language code
 */
export function getDateLocale(lang: string): string {
  const map: Record<string, string> = {
    en: "en-US", vi: "vi-VN", ja: "ja-JP", ko: "ko-KR", zh: "zh-CN",
    fr: "fr-FR", es: "es-ES", de: "de-DE", pt: "pt-BR", th: "th-TH",
    ar: "ar-SA", ru: "ru-RU", it: "it-IT", nl: "nl-NL", pl: "pl-PL",
    tr: "tr-TR", id: "id-ID", hi: "hi-IN", sv: "sv-SE", uk: "uk-UA",
  };
  const code = lang.toLowerCase().split("-")[0];
  return map[code] || "en-US";
}
