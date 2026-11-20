const DASHBOARD_LOGIN_URL = "http://localhost:3000/login";
const DEFAULT_LANGUAGE = "en";

const translations = {
  en: {
    metaTitle: "BeAlpha - Music Distribution Infrastructure",
    metaDescription: "BeAlpha is music distribution infrastructure for labels, aggregators, and artists.",
    "nav.platform": "Platform",
    "nav.culture": "Culture",
    "nav.workflow": "Workflow",
    "nav.security": "Security",
    "nav.contact": "Contact",
    "nav.signIn": "Sign in",
    "hero.kicker": "Music infrastructure for modern catalogs",
    "hero.title": "Move music from local scenes to global platforms.",
    "hero.copy": "BeAlpha gives labels, aggregators, and artists one clean operating system for catalog delivery, rights data, royalties, and audience insight.",
    "hero.primary": "Request access",
    "hero.secondary": "Explore platform",
    "console.title": "Live delivery desk",
    "console.status": "Operational",
    "console.row1.status": "Queued",
    "console.row1.title": "Midnight Saigon",
    "console.row1.meta": "Album - 12 tracks - DDEX ready",
    "console.row2.status": "Delivered",
    "console.row2.title": "Seoul Afterhours",
    "console.row2.meta": "Single - receipts confirmed",
    "console.row3.status": "Review",
    "console.row3.title": "Lagos Signal",
    "console.row3.meta": "Metadata QC pending",
    "strip.label": "Designed for catalogs moving across",
    "platform.kicker": "Dashboard-aligned public experience",
    "platform.title": "The same control-room language as the BeAlpha dashboard.",
    "platform.copy": "Dark, focused, operational, and built for repeated use. The public site now shares the product rhythm: clean surfaces, precise icons, blue state accents, and concise interface copy.",
    "features.catalog.title": "Catalog command",
    "features.catalog.copy": "Manage releases, assets, identifiers, territories, and delivery state without fragmenting work across spreadsheets.",
    "features.delivery.title": "Delivery routing",
    "features.delivery.copy": "Package releases, validate metadata, dispatch to partners, and surface receipts back to operators.",
    "features.royalty.title": "Royalty clarity",
    "features.royalty.copy": "Cascade revenue through distributors, label groups, labels, and artists with transparent statement logic.",
    "features.insight.title": "Audience insight",
    "features.insight.copy": "Track catalog momentum by release, market, playlist, and catalog owner without exposing another tenant's data.",
    "culture.kicker": "Cultural reach",
    "culture.title": "Built for music scenes, not only music files.",
    "culture.copy": "The interface respects how catalogs actually grow: regional languages, local release timing, multi-role teams, and artists who need their work to travel without losing context.",
    "culture.cta": "Talk to BeAlpha",
    "culture.scene1.title": "Saigon releases",
    "culture.scene1.copy": "Vietnamese-first metadata and label workflows.",
    "culture.scene2.title": "Seoul collaborations",
    "culture.scene2.copy": "Multi-artist credits and territory-aware scheduling.",
    "culture.scene3.title": "Global catalog desks",
    "culture.scene3.copy": "One operating layer for teams across time zones.",
    "workflow.kicker": "Workflow",
    "workflow.title": "A practical path from master to statement.",
    "workflow.step1.title": "Upload",
    "workflow.step1.copy": "Bring in audio, video, artwork, and supporting files through secure media endpoints.",
    "workflow.step2.title": "Check",
    "workflow.step2.copy": "Validate identifiers, credits, release timing, territories, and package readiness.",
    "workflow.step3.title": "Deliver",
    "workflow.step3.copy": "Generate delivery packages, route them, and keep the operator informed with status changes.",
    "workflow.step4.title": "Measure",
    "workflow.step4.copy": "Read performance by release, market, playlist, and catalog owner.",
    "workflow.step5.title": "Pay",
    "workflow.step5.copy": "Convert reports into clear royalty statements for every tier of the supply chain.",
    "product.title": "Catalog health",
    "product.metric1": "metadata pass rate",
    "product.metric2": "delivery targets",
    "product.item1": "Signed streams for unreleased media",
    "product.item2": "Tenant scoped catalog visibility",
    "product.item3": "Audit trail for delivery actions",
    "security.kicker": "Security and trust",
    "security.title": "Designed for unreleased music and financial data.",
    "security.copy": "BeAlpha treats catalog media, rights metadata, and royalty records as sensitive infrastructure. Public design now mirrors that posture: restrained, readable, and enterprise-ready.",
    "security.point1": "Short-lived media access",
    "security.point2": "Hierarchy-aware permissions",
    "security.point3": "Action-level audit history",
    "cta.title": "Bring your catalog into a cleaner operating layer.",
    "cta.copy": "Request access for your label, aggregator, or artist team. BeAlpha will review the fit and respond with the next step.",
    "cta.primary": "Request access",
    "cta.secondary": "Dashboard sign in",
    "footer.copy": "Music distribution infrastructure for catalog teams, labels, and artists.",
    "footer.platform": "Platform",
    "footer.company": "Company",
    "footer.rights": "All rights reserved.",
    "contact.kicker": "Request access",
    "contact.title": "Tell us about your catalog operation.",
    "contact.copy": "Share enough detail for the BeAlpha team to understand your role, release volume, and delivery needs.",
    "contact.response.title": "Response window",
    "contact.response.copy": "Qualified requests are reviewed within two business days.",
    "contact.fit.title": "Best fit",
    "contact.fit.copy": "Labels, aggregators, and serious artist teams with active or planned release schedules.",
    "contact.support.title": "Existing users",
    "contact.support.copy": "Use the dashboard sign-in and contact support from your account workspace.",
    "form.name": "Name",
    "form.email": "Email",
    "form.company": "Company or artist name",
    "form.role": "Role",
    "form.role.placeholder": "Select one",
    "form.role.aggregator": "Aggregator",
    "form.role.label": "Label",
    "form.role.artist": "Artist",
    "form.role.partner": "Partner",
    "form.message": "What do you need from BeAlpha?",
    "form.consent": "I agree to be contacted about BeAlpha access.",
    "form.submit": "Submit request",
    "form.sending": "Sending...",
    "form.error": "Please complete every required field.",
    "form.success": "Thanks. Your request is ready for the BeAlpha team to review."
  },
  vi: {
    metaTitle: "BeAlpha - Hạ tầng phân phối âm nhạc",
    metaDescription: "BeAlpha là hạ tầng phân phối âm nhạc cho label, aggregator và nghệ sĩ.",
    "nav.platform": "Nền tảng",
    "nav.culture": "Văn hoá",
    "nav.workflow": "Quy trình",
    "nav.security": "Bảo mật",
    "nav.contact": "Liên hệ",
    "nav.signIn": "Đăng nhập",
    "hero.kicker": "Hạ tầng âm nhạc cho catalog hiện đại",
    "hero.title": "Đưa âm nhạc từ cộng đồng địa phương ra nền tảng toàn cầu.",
    "hero.copy": "BeAlpha giúp label, aggregator và nghệ sĩ quản lý phân phối catalog, dữ liệu quyền, doanh thu và insight khán giả trong một hệ điều hành gọn gàng.",
    "hero.primary": "Yêu cầu truy cập",
    "hero.secondary": "Khám phá nền tảng",
    "console.title": "Bàn điều phối trực tiếp",
    "console.status": "Đang hoạt động",
    "console.row1.status": "Đang chờ",
    "console.row1.title": "Midnight Saigon",
    "console.row1.meta": "Album - 12 bài - sẵn sàng DDEX",
    "console.row2.status": "Đã gửi",
    "console.row2.title": "Seoul Afterhours",
    "console.row2.meta": "Single - đã xác nhận receipt",
    "console.row3.status": "Cần duyệt",
    "console.row3.title": "Lagos Signal",
    "console.row3.meta": "Đang kiểm tra metadata",
    "strip.label": "Thiết kế cho catalog đi qua",
    "platform.kicker": "Giao diện public đồng bộ dashboard",
    "platform.title": "Cùng ngôn ngữ điều hành với dashboard BeAlpha.",
    "platform.copy": "Tối, tập trung, thực dụng và phù hợp cho thao tác lặp lại. Website public giờ dùng cùng nhịp sản phẩm: surface sạch, icon rõ, accent xanh và copy ngắn gọn.",
    "features.catalog.title": "Điều khiển catalog",
    "features.catalog.copy": "Quản lý release, asset, mã định danh, lãnh thổ và trạng thái giao hàng mà không tách việc sang spreadsheet.",
    "features.delivery.title": "Định tuyến phân phối",
    "features.delivery.copy": "Đóng gói release, kiểm tra metadata, gửi tới đối tác và đưa receipt về lại cho đội vận hành.",
    "features.royalty.title": "Doanh thu minh bạch",
    "features.royalty.copy": "Chia doanh thu qua distributor, label group, label và nghệ sĩ bằng logic statement rõ ràng.",
    "features.insight.title": "Insight khán giả",
    "features.insight.copy": "Theo dõi catalog theo release, thị trường, playlist và chủ sở hữu mà không lộ dữ liệu tenant khác.",
    "culture.kicker": "Tầm với văn hoá",
    "culture.title": "Xây cho scene âm nhạc, không chỉ cho file nhạc.",
    "culture.copy": "Giao diện tôn trọng cách catalog phát triển thật: ngôn ngữ địa phương, lịch phát hành theo vùng, đội nhiều vai trò và nghệ sĩ cần âm nhạc đi xa mà không mất ngữ cảnh.",
    "culture.cta": "Trao đổi với BeAlpha",
    "culture.scene1.title": "Phát hành từ Sài Gòn",
    "culture.scene1.copy": "Metadata tiếng Việt và workflow label bản địa.",
    "culture.scene2.title": "Hợp tác Seoul",
    "culture.scene2.copy": "Credit nhiều nghệ sĩ và lịch phát hành theo lãnh thổ.",
    "culture.scene3.title": "Bàn catalog toàn cầu",
    "culture.scene3.copy": "Một lớp vận hành cho đội ở nhiều múi giờ.",
    "workflow.kicker": "Quy trình",
    "workflow.title": "Một đường đi rõ từ master tới statement.",
    "workflow.step1.title": "Upload",
    "workflow.step1.copy": "Đưa audio, video, artwork và file hỗ trợ vào endpoint media bảo mật.",
    "workflow.step2.title": "Kiểm tra",
    "workflow.step2.copy": "Xác thực mã định danh, credit, lịch phát hành, lãnh thổ và trạng thái gói.",
    "workflow.step3.title": "Phân phối",
    "workflow.step3.copy": "Tạo package giao hàng, định tuyến và cập nhật trạng thái cho operator.",
    "workflow.step4.title": "Đo lường",
    "workflow.step4.copy": "Đọc hiệu suất theo release, thị trường, playlist và chủ catalog.",
    "workflow.step5.title": "Thanh toán",
    "workflow.step5.copy": "Chuyển report thành statement rõ ràng cho từng tầng trong chuỗi cung ứng.",
    "product.title": "Sức khoẻ catalog",
    "product.metric1": "metadata đạt chuẩn",
    "product.metric2": "đích phân phối",
    "product.item1": "Stream ký token cho media chưa phát hành",
    "product.item2": "Hiển thị catalog theo tenant",
    "product.item3": "Audit trail cho thao tác phân phối",
    "security.kicker": "Bảo mật và niềm tin",
    "security.title": "Thiết kế cho nhạc chưa phát hành và dữ liệu tài chính.",
    "security.copy": "BeAlpha xem media catalog, metadata quyền và doanh thu như hạ tầng nhạy cảm. Thiết kế public giờ phản ánh điều đó: tiết chế, dễ đọc và sẵn sàng cho doanh nghiệp.",
    "security.point1": "Truy cập media ngắn hạn",
    "security.point2": "Phân quyền theo phân cấp",
    "security.point3": "Lịch sử thao tác chi tiết",
    "cta.title": "Đưa catalog vào một lớp vận hành sạch hơn.",
    "cta.copy": "Yêu cầu truy cập cho label, aggregator hoặc đội nghệ sĩ. BeAlpha sẽ xem xét và phản hồi bước tiếp theo.",
    "cta.primary": "Yêu cầu truy cập",
    "cta.secondary": "Đăng nhập dashboard",
    "footer.copy": "Hạ tầng phân phối âm nhạc cho đội catalog, label và nghệ sĩ.",
    "footer.platform": "Nền tảng",
    "footer.company": "Công ty",
    "footer.rights": "Đã đăng ký bản quyền.",
    "contact.kicker": "Yêu cầu truy cập",
    "contact.title": "Cho chúng tôi biết về catalog của bạn.",
    "contact.copy": "Chia sẻ đủ thông tin để đội BeAlpha hiểu vai trò, khối lượng phát hành và nhu cầu phân phối.",
    "contact.response.title": "Thời gian phản hồi",
    "contact.response.copy": "Yêu cầu phù hợp được xem xét trong vòng hai ngày làm việc.",
    "contact.fit.title": "Phù hợp nhất",
    "contact.fit.copy": "Label, aggregator và đội nghệ sĩ nghiêm túc có lịch phát hành đang chạy hoặc sắp chạy.",
    "contact.support.title": "Người dùng hiện tại",
    "contact.support.copy": "Đăng nhập dashboard và liên hệ hỗ trợ từ workspace tài khoản.",
    "form.name": "Tên",
    "form.email": "Email",
    "form.company": "Công ty hoặc nghệ danh",
    "form.role": "Vai trò",
    "form.role.placeholder": "Chọn một mục",
    "form.role.aggregator": "Aggregator",
    "form.role.label": "Label",
    "form.role.artist": "Nghệ sĩ",
    "form.role.partner": "Đối tác",
    "form.message": "Bạn cần gì từ BeAlpha?",
    "form.consent": "Tôi đồng ý để BeAlpha liên hệ về quyền truy cập.",
    "form.submit": "Gửi yêu cầu",
    "form.sending": "Đang gửi...",
    "form.error": "Vui lòng điền đầy đủ các trường bắt buộc.",
    "form.success": "Cảm ơn. Yêu cầu của bạn đã sẵn sàng để đội BeAlpha xem xét."
  },
  ja: {
    metaTitle: "BeAlpha - 音楽配信インフラ",
    metaDescription: "BeAlphaはレーベル、アグリゲーター、アーティスト向けの音楽配信インフラです。",
    "nav.platform": "プラットフォーム",
    "nav.culture": "カルチャー",
    "nav.workflow": "ワークフロー",
    "nav.security": "セキュリティ",
    "nav.contact": "お問い合わせ",
    "nav.signIn": "サインイン",
    "hero.kicker": "現代のカタログ向け音楽インフラ",
    "hero.title": "ローカルシーンの音楽をグローバルな配信先へ。",
    "hero.copy": "BeAlphaは、レーベル、アグリゲーター、アーティストのために、カタログ配信、権利データ、ロイヤリティ、オーディエンス分析を一つの運用レイヤーにまとめます。",
    "hero.primary": "アクセスを申請",
    "hero.secondary": "プラットフォームを見る",
    "console.title": "ライブ配信デスク",
    "console.status": "稼働中",
    "console.row1.status": "待機中",
    "console.row1.title": "Midnight Saigon",
    "console.row1.meta": "アルバム - 12曲 - DDEX準備完了",
    "console.row2.status": "配信済み",
    "console.row2.title": "Seoul Afterhours",
    "console.row2.meta": "シングル - レシート確認済み",
    "console.row3.status": "確認中",
    "console.row3.title": "Lagos Signal",
    "console.row3.meta": "メタデータQC待ち",
    "strip.label": "カタログが接続する主な場所",
    "platform.kicker": "ダッシュボードと統一された公開体験",
    "platform.title": "BeAlphaダッシュボードと同じ運用言語。",
    "platform.copy": "暗く、集中でき、運用向けで、繰り返し使える設計。公開サイトも、クリーンなサーフェス、精密なアイコン、青い状態アクセント、簡潔なコピーで製品のリズムに合わせました。",
    "features.catalog.title": "カタログ管理",
    "features.catalog.copy": "リリース、アセット、識別子、地域、配信状態をスプレッドシートに分散させずに管理できます。",
    "features.delivery.title": "配信ルーティング",
    "features.delivery.copy": "リリースをパッケージ化し、メタデータを検証し、パートナーへ送信し、レシートを運用画面に戻します。",
    "features.royalty.title": "ロイヤリティの透明性",
    "features.royalty.copy": "ディストリビューター、レーベルグループ、レーベル、アーティストへ明確なステートメントロジックで収益を配分します。",
    "features.insight.title": "オーディエンス分析",
    "features.insight.copy": "他テナントのデータを露出せず、リリース、市場、プレイリスト、所有者別にカタログの勢いを確認できます。",
    "culture.kicker": "カルチャーへの到達",
    "culture.title": "音楽ファイルだけでなく、音楽シーンのために。",
    "culture.copy": "地域言語、ローカルな発売タイミング、複数ロールのチーム、そして文脈を失わず音楽を届けたいアーティストを前提にしています。",
    "culture.cta": "BeAlphaに相談",
    "culture.scene1.title": "サイゴン発のリリース",
    "culture.scene1.copy": "ベトナム語優先のメタデータとレーベル運用。",
    "culture.scene2.title": "ソウルのコラボレーション",
    "culture.scene2.copy": "複数アーティストのクレジットと地域別スケジュール。",
    "culture.scene3.title": "グローバルなカタログデスク",
    "culture.scene3.copy": "タイムゾーンをまたぐチームのための一つの運用レイヤー。",
    "workflow.kicker": "ワークフロー",
    "workflow.title": "マスターからステートメントまでの実用的な流れ。",
    "workflow.step1.title": "アップロード",
    "workflow.step1.copy": "音源、映像、アートワーク、関連ファイルを安全なメディアエンドポイントに取り込みます。",
    "workflow.step2.title": "チェック",
    "workflow.step2.copy": "識別子、クレジット、発売日、地域、パッケージ準備状況を検証します。",
    "workflow.step3.title": "配信",
    "workflow.step3.copy": "配信パッケージを生成し、ルーティングし、状態変更を運用者に表示します。",
    "workflow.step4.title": "計測",
    "workflow.step4.copy": "リリース、市場、プレイリスト、カタログ所有者ごとに実績を読み取ります。",
    "workflow.step5.title": "支払い",
    "workflow.step5.copy": "レポートを、サプライチェーン各層の明確なロイヤリティステートメントへ変換します。",
    "product.title": "カタログヘルス",
    "product.metric1": "メタデータ通過率",
    "product.metric2": "配信先",
    "product.item1": "未発売メディア向け署名付きストリーム",
    "product.item2": "テナント単位のカタログ可視性",
    "product.item3": "配信操作の監査履歴",
    "security.kicker": "セキュリティと信頼",
    "security.title": "未発売音源と金融データのための設計。",
    "security.copy": "BeAlphaはカタログメディア、権利メタデータ、ロイヤリティ記録を重要なインフラとして扱います。公開サイトもその姿勢に合わせ、抑制され、読みやすく、エンタープライズ向けに整えました。",
    "security.point1": "短時間のメディアアクセス",
    "security.point2": "階層を理解した権限",
    "security.point3": "操作単位の監査履歴",
    "cta.title": "カタログをより整理された運用レイヤーへ。",
    "cta.copy": "レーベル、アグリゲーター、アーティストチームとしてアクセスを申請してください。BeAlphaが適合性を確認し、次のステップを返します。",
    "cta.primary": "アクセスを申請",
    "cta.secondary": "ダッシュボードへ",
    "footer.copy": "カタログチーム、レーベル、アーティストのための音楽配信インフラ。",
    "footer.platform": "プラットフォーム",
    "footer.company": "会社",
    "footer.rights": "All rights reserved.",
    "contact.kicker": "アクセス申請",
    "contact.title": "あなたのカタログ運用について教えてください。",
    "contact.copy": "役割、リリース量、配信ニーズが分かる内容を共有してください。",
    "contact.response.title": "返信目安",
    "contact.response.copy": "適合する申請は2営業日以内に確認されます。",
    "contact.fit.title": "主な対象",
    "contact.fit.copy": "稼働中または予定のあるレーベル、アグリゲーター、本格的なアーティストチーム。",
    "contact.support.title": "既存ユーザー",
    "contact.support.copy": "ダッシュボードにサインインし、アカウントワークスペースからサポートへ連絡してください。",
    "form.name": "名前",
    "form.email": "メール",
    "form.company": "会社名またはアーティスト名",
    "form.role": "役割",
    "form.role.placeholder": "選択してください",
    "form.role.aggregator": "アグリゲーター",
    "form.role.label": "レーベル",
    "form.role.artist": "アーティスト",
    "form.role.partner": "パートナー",
    "form.message": "BeAlphaに期待すること",
    "form.consent": "BeAlphaアクセスについて連絡を受けることに同意します。",
    "form.submit": "申請を送信",
    "form.sending": "送信中...",
    "form.error": "必須項目をすべて入力してください。",
    "form.success": "ありがとうございます。BeAlphaチームが確認できる状態になりました。"
  },
  ko: {
    metaTitle: "BeAlpha - 음악 유통 인프라",
    metaDescription: "BeAlpha는 레이블, 애그리게이터, 아티스트를 위한 음악 유통 인프라입니다.",
    "nav.platform": "플랫폼",
    "nav.culture": "문화",
    "nav.workflow": "워크플로",
    "nav.security": "보안",
    "nav.contact": "문의",
    "nav.signIn": "로그인",
    "hero.kicker": "현대 카탈로그를 위한 음악 인프라",
    "hero.title": "로컬 신의 음악을 글로벌 플랫폼으로 이동합니다.",
    "hero.copy": "BeAlpha는 레이블, 애그리게이터, 아티스트가 카탈로그 유통, 권리 데이터, 로열티, 청중 인사이트를 하나의 운영 레이어에서 다루도록 돕습니다.",
    "hero.primary": "접근 요청",
    "hero.secondary": "플랫폼 보기",
    "console.title": "라이브 딜리버리 데스크",
    "console.status": "정상 운영",
    "console.row1.status": "대기",
    "console.row1.title": "Midnight Saigon",
    "console.row1.meta": "앨범 - 12트랙 - DDEX 준비 완료",
    "console.row2.status": "전송 완료",
    "console.row2.title": "Seoul Afterhours",
    "console.row2.meta": "싱글 - 영수증 확인",
    "console.row3.status": "검토",
    "console.row3.title": "Lagos Signal",
    "console.row3.meta": "메타데이터 QC 대기",
    "strip.label": "카탈로그가 이동하는 채널",
    "platform.kicker": "대시보드와 맞춘 공개 경험",
    "platform.title": "BeAlpha 대시보드와 같은 운영 언어.",
    "platform.copy": "어둡고 집중되며 운영에 맞고 반복 사용에 적합합니다. 공개 사이트도 깨끗한 표면, 정밀한 아이콘, 파란 상태 색상, 간결한 카피로 제품 리듬을 공유합니다.",
    "features.catalog.title": "카탈로그 제어",
    "features.catalog.copy": "릴리즈, 에셋, 식별자, 지역, 전송 상태를 스프레드시트에 흩어 두지 않고 관리합니다.",
    "features.delivery.title": "딜리버리 라우팅",
    "features.delivery.copy": "릴리즈를 패키징하고 메타데이터를 검증하며 파트너에게 전송하고 영수증을 운영자에게 되돌립니다.",
    "features.royalty.title": "로열티 투명성",
    "features.royalty.copy": "디스트리뷰터, 레이블 그룹, 레이블, 아티스트까지 명확한 정산 로직으로 수익을 배분합니다.",
    "features.insight.title": "청중 인사이트",
    "features.insight.copy": "다른 테넌트 데이터를 노출하지 않고 릴리즈, 시장, 플레이리스트, 소유자별 성과를 확인합니다.",
    "culture.kicker": "문화적 도달",
    "culture.title": "음악 파일이 아니라 음악 신을 위해 설계했습니다.",
    "culture.copy": "지역 언어, 현지 발매 일정, 여러 역할의 팀, 문맥을 잃지 않고 음악을 전달해야 하는 아티스트를 고려합니다.",
    "culture.cta": "BeAlpha와 상담",
    "culture.scene1.title": "사이공 릴리즈",
    "culture.scene1.copy": "베트남어 우선 메타데이터와 레이블 워크플로.",
    "culture.scene2.title": "서울 협업",
    "culture.scene2.copy": "다중 아티스트 크레딧과 지역별 일정.",
    "culture.scene3.title": "글로벌 카탈로그 데스크",
    "culture.scene3.copy": "여러 시간대의 팀을 위한 하나의 운영 레이어.",
    "workflow.kicker": "워크플로",
    "workflow.title": "마스터에서 정산서까지의 실용적인 경로.",
    "workflow.step1.title": "업로드",
    "workflow.step1.copy": "오디오, 비디오, 아트워크, 지원 파일을 보안 미디어 엔드포인트로 가져옵니다.",
    "workflow.step2.title": "검사",
    "workflow.step2.copy": "식별자, 크레딧, 발매 일정, 지역, 패키지 준비 상태를 검증합니다.",
    "workflow.step3.title": "전송",
    "workflow.step3.copy": "전송 패키지를 만들고 라우팅하며 상태 변화를 운영자에게 알려줍니다.",
    "workflow.step4.title": "측정",
    "workflow.step4.copy": "릴리즈, 시장, 플레이리스트, 카탈로그 소유자별 성과를 읽습니다.",
    "workflow.step5.title": "지급",
    "workflow.step5.copy": "리포트를 공급망 각 단계에 맞는 명확한 로열티 정산서로 변환합니다.",
    "product.title": "카탈로그 상태",
    "product.metric1": "메타데이터 통과율",
    "product.metric2": "전송 대상",
    "product.item1": "미발매 미디어용 서명 스트림",
    "product.item2": "테넌트 단위 카탈로그 가시성",
    "product.item3": "전송 작업 감사 기록",
    "security.kicker": "보안과 신뢰",
    "security.title": "미발매 음악과 재무 데이터를 위한 설계.",
    "security.copy": "BeAlpha는 카탈로그 미디어, 권리 메타데이터, 로열티 기록을 민감한 인프라로 다룹니다. 공개 디자인도 그 태도를 반영해 절제되고 읽기 쉬우며 엔터프라이즈에 맞게 구성했습니다.",
    "security.point1": "짧은 수명의 미디어 접근",
    "security.point2": "계층 인식 권한",
    "security.point3": "작업 단위 감사 기록",
    "cta.title": "카탈로그를 더 깨끗한 운영 레이어로 가져오세요.",
    "cta.copy": "레이블, 애그리게이터, 아티스트 팀으로 접근을 요청하세요. BeAlpha가 적합성을 검토하고 다음 단계를 안내합니다.",
    "cta.primary": "접근 요청",
    "cta.secondary": "대시보드 로그인",
    "footer.copy": "카탈로그 팀, 레이블, 아티스트를 위한 음악 유통 인프라.",
    "footer.platform": "플랫폼",
    "footer.company": "회사",
    "footer.rights": "All rights reserved.",
    "contact.kicker": "접근 요청",
    "contact.title": "카탈로그 운영에 대해 알려주세요.",
    "contact.copy": "역할, 릴리즈 규모, 유통 요구사항을 이해할 수 있도록 공유해 주세요.",
    "contact.response.title": "응답 시간",
    "contact.response.copy": "적합한 요청은 영업일 기준 2일 안에 검토됩니다.",
    "contact.fit.title": "적합한 팀",
    "contact.fit.copy": "실제 또는 예정된 릴리즈 일정이 있는 레이블, 애그리게이터, 아티스트 팀.",
    "contact.support.title": "기존 사용자",
    "contact.support.copy": "대시보드에 로그인한 뒤 계정 워크스페이스에서 지원을 요청하세요.",
    "form.name": "이름",
    "form.email": "이메일",
    "form.company": "회사 또는 아티스트명",
    "form.role": "역할",
    "form.role.placeholder": "선택",
    "form.role.aggregator": "애그리게이터",
    "form.role.label": "레이블",
    "form.role.artist": "아티스트",
    "form.role.partner": "파트너",
    "form.message": "BeAlpha에서 필요한 것",
    "form.consent": "BeAlpha 접근 관련 연락에 동의합니다.",
    "form.submit": "요청 제출",
    "form.sending": "전송 중...",
    "form.error": "필수 항목을 모두 입력해 주세요.",
    "form.success": "감사합니다. BeAlpha 팀이 검토할 수 있도록 요청이 준비되었습니다."
  }
};

document.addEventListener("DOMContentLoaded", () => {
  const language = getSavedLanguage();
  setupNavigation();
  setupDashboardLinks();
  setupLanguage(language);
  setupReveal();
  setupForms();
  setCurrentYear();
});

function getSavedLanguage() {
  const stored = localStorage.getItem("bealpha_home_language");
  return translations[stored] ? stored : DEFAULT_LANGUAGE;
}

function setupLanguage(initialLanguage) {
  const selectors = document.querySelectorAll("[data-language-select]");
  selectors.forEach((select) => {
    select.value = initialLanguage;
    select.addEventListener("change", () => {
      const nextLanguage = select.value;
      localStorage.setItem("bealpha_home_language", nextLanguage);
      applyLanguage(nextLanguage);
      selectors.forEach((other) => {
        other.value = nextLanguage;
      });
    });
  });
  applyLanguage(initialLanguage);
}

function applyLanguage(language) {
  const dictionary = translations[language] || translations[DEFAULT_LANGUAGE];
  document.documentElement.lang = language;
  document.title = dictionary.metaTitle;

  const description = document.querySelector('meta[name="description"]');
  if (description) {
    description.setAttribute("content", dictionary.metaDescription);
  }

  document.querySelectorAll("[data-i18n]").forEach((element) => {
    const key = element.getAttribute("data-i18n");
    if (key && dictionary[key]) {
      element.textContent = dictionary[key];
    }
  });
}

function setupNavigation() {
  const header = document.querySelector("[data-header]");
  const menuToggle = document.querySelector("[data-menu-toggle]");
  const nav = document.getElementById("site-nav");

  if (header) {
    const updateHeader = () => {
      header.classList.toggle("is-scrolled", window.scrollY > 16);
    };
    updateHeader();
    window.addEventListener("scroll", updateHeader, { passive: true });
  }

  if (!menuToggle || !nav) return;

  menuToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    document.body.classList.toggle("menu-open", isOpen);
    menuToggle.setAttribute("aria-expanded", String(isOpen));
    const icon = menuToggle.querySelector(".material-symbols-rounded");
    if (icon) icon.textContent = isOpen ? "close" : "menu";
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      document.body.classList.remove("menu-open");
      menuToggle.setAttribute("aria-expanded", "false");
      const icon = menuToggle.querySelector(".material-symbols-rounded");
      if (icon) icon.textContent = "menu";
    });
  });
}

function setupDashboardLinks() {
  document.querySelectorAll("[data-dashboard-login]").forEach((link) => {
    link.addEventListener("click", (event) => {
      event.preventDefault();
      window.location.href = DASHBOARD_LOGIN_URL;
    });
  });
}

function setupReveal() {
  const targets = Array.from(document.querySelectorAll(".reveal"));
  if (!targets.length || !("IntersectionObserver" in window)) {
    targets.forEach((target) => target.classList.add("is-visible"));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: "0px 0px -48px 0px" }
  );

  targets.forEach((target) => observer.observe(target));
}

function setupForms() {
  document.querySelectorAll("form").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const language = getSavedLanguage();
      const dictionary = translations[language] || translations[DEFAULT_LANGUAGE];
      const status = form.querySelector(".form-status");
      const invalidFields = validateForm(form);

      if (status) {
        status.className = "form-status";
        status.textContent = "";
      }

      if (invalidFields.length > 0) {
        if (status) {
          status.textContent = dictionary["form.error"];
          status.classList.add("error");
        }
        invalidFields[0].focus();
        return;
      }

      const submitButton = form.querySelector("[data-submit-label]");
      const originalLabel = submitButton ? submitButton.textContent : "";
      if (submitButton) {
        submitButton.disabled = true;
        submitButton.textContent = dictionary["form.sending"];
      }

      window.setTimeout(() => {
        form.reset();
        if (submitButton) {
          submitButton.disabled = false;
          submitButton.textContent = originalLabel;
        }
        if (status) {
          status.textContent = dictionary["form.success"];
          status.classList.add("success");
        }
      }, 650);
    });
  });
}

function validateForm(form) {
  const requiredFields = Array.from(form.querySelectorAll("[required]"));
  const invalidFields = [];

  requiredFields.forEach((field) => {
    const isValid = isFieldValid(field);
    field.setAttribute("aria-invalid", String(!isValid));
    if (!isValid) invalidFields.push(field);
  });

  return invalidFields;
}

function isFieldValid(field) {
  if (field.type === "checkbox") return field.checked;
  if (field.type === "email") return /\S+@\S+\.\S+/.test(field.value.trim());
  return field.value.trim().length > 0;
}

function setCurrentYear() {
  document.querySelectorAll("#current-year").forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });
}
