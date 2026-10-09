export const metadata = {
  title: "隐私政策 · 墨架 Inkshelf",
  description: "墨架 Inkshelf 的隐私政策：收集什么、怎么用、如何删除。",
};

export default function PrivacyPage() {
  return (
    <main className="legal">
      <h1>隐私政策 / Privacy Policy</h1>
      <p className="updated">最后更新：2026-10-09</p>

      <h2>一句话</h2>
      <p>
        墨架（Inkshelf）只收集让你登录所必需的邮箱地址。你导入的书籍、划线、笔记和生词存放在为你的账号开通的数据库中，
        只有你本人能访问。我们不做广告、不做追踪、不接第三方分析、不把你的数据卖给任何人。
      </p>

      <h2>我们收集什么</h2>
      <ul>
        <li>
          <strong>邮箱地址</strong>——用于创建账号与登录。认证由 Supabase 提供。
        </li>
        <li>
          <strong>你导入的内容</strong>——你主动导入的 PDF / EPUB 文件，以及你创建的划线、笔记、生词。
          它们存放在私有存储桶与数据库中，通过行级安全策略（RLS）限定为仅所有者可读写。
        </li>
        <li>
          <strong>阅读记录</strong>——阅读时长与进度，用于在你自己的统计页面展示。
        </li>
      </ul>

      <h2>我们不收集什么</h2>
      <ul>
        <li>不收集位置、通讯录、照片、健康或支付信息</li>
        <li>不使用广告标识符，不进行跨 App 或跨网站追踪</li>
        <li>不接入第三方分析或广告 SDK</li>
        <li>不把你的书籍或笔记内容发送给任何人工智能服务——点词翻译使用 App 内置的离线词典</li>
      </ul>

      <h2>数据存放在哪里</h2>
      <p>
        数据存放在 Supabase（PostgreSQL 与对象存储）。网络传输使用 HTTPS 加密。
        在你的设备上，已下载的书籍会被缓存，以便离线阅读；删除该书或卸载 App 即清除。
      </p>

      <h2>删除你的数据</h2>
      <p>
        在 App 内移除一本书会同时删除其文件与本地缓存。若要删除整个账号及其全部数据，
        发送邮件至 <a href="mailto:ptp.qiuyu@gmail.com">ptp.qiuyu@gmail.com</a>，我们会在 30 天内处理完毕。
      </p>

      <h2>儿童</h2>
      <p>墨架面向一般受众，不针对 13 岁以下儿童，也不会在知情的情况下收集儿童的个人信息。</p>

      <h2>变更</h2>
      <p>本政策如有更新，会在本页面标注新的更新日期。</p>

      <h2>联系方式</h2>
      <p>
        <a href="mailto:ptp.qiuyu@gmail.com">ptp.qiuyu@gmail.com</a> ·{" "}
        <a href="https://github.com/Jada-Q/inkshelf">github.com/Jada-Q/inkshelf</a>
      </p>

      <hr />

      <h2>English summary</h2>
      <p>
        Inkshelf collects only the email address needed to sign you in. Books you import and the highlights,
        notes and words you create are stored in a database scoped to your account by row-level security —
        only you can read them. No ads, no tracking, no third-party analytics, no data sold. Your book content
        is never sent to any AI service; word lookup uses an offline dictionary bundled in the app. Downloaded
        books are cached on your device for offline reading and are removed when you delete the book or the app.
        To delete your account and all data, email ptp.qiuyu@gmail.com; we process requests within 30 days.
      </p>
    </main>
  );
}
