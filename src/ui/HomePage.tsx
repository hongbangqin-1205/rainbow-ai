type HomeCard = { eyebrow: string; title: string; description: string; kind: string; page: 'text' | 'image' | 'workspace' | 'assistant' }

const cards: HomeCard[] = [
  { eyebrow: 'IMAGE', title: '图片创作', description: '把想象变成画面', kind: 'image-art', page: 'image' },
  { eyebrow: 'VIDEO', title: '视频创作', description: '让故事开始发生', kind: 'video-art', page: 'workspace' },
  { eyebrow: 'CHAT', title: '文本对话', description: '写文案 · 理思路 · 做脚本', kind: 'chat-art', page: 'text' },
  { eyebrow: 'PROJECT', title: '项目空间', description: '管理项目 · 安排任务 · 跟踪进度', kind: 'agent-art', page: 'assistant' },
]

export function HomePage({ onNavigate }: { onNavigate: (page: HomeCard['page']) => void }) {
  return <main className="home-page">
    <section className="home-hero"><div><p className="home-kicker">RAINBOW AI · CREATIVE STUDIO</p><h1>今天，想创作点什么？</h1><p>写文案、生成图片、制作视频，都可以交给我</p></div><button className="hero-link" onClick={() => onNavigate('assistant')}>去广场找灵感　↗</button></section>
    <section className="creation-grid">{cards.map((card) => <button key={card.title} className={`creation-card ${card.kind}`} onClick={() => onNavigate(card.page)}><div className="creation-orb" /><div className="creation-copy"><small>{card.eyebrow}</small><h2>{card.title}</h2><p>{card.description}</p></div><span className="creation-arrow">↗</span></button>)}</section>
    <section className="quick-links"><button onClick={() => onNavigate('workspace')}><span>▣</span><div><strong>视频工作台</strong><small>连接素材与创作步骤</small></div><i>↗</i></button><button onClick={() => onNavigate('text')}><span>▤</span><div><strong>短文 / 脚本</strong><small>整理脚本与项目</small></div><i>↗</i></button></section>
    <section className="prompt-section"><h2>从一句话开始创作</h2><div className="prompt-box"><div className="prompt-tabs"><button className="selected" onClick={() => onNavigate('assistant')}>✧ 自动</button><button onClick={() => onNavigate('text')}>▢ 对话</button><button onClick={() => onNavigate('image')}>▧ 图片</button><button onClick={() => onNavigate('workspace')}>▤ 视频</button><button onClick={() => onNavigate('assistant')}>♙ 助手⌄</button></div><textarea placeholder="Hi~有什么想问小助手的" /><div className="prompt-footer"><span>⌕</span><span className="prompt-mic">♩</span><button onClick={() => onNavigate('assistant')}>↑</button></div></div><small className="prompt-note">内容由 AI 生成，请注意甄别</small></section>
  </main>
}
