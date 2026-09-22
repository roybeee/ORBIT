import Link from 'next/link';
import {requireChatGPTUser} from '../chatgpt-auth';
import {OrbitMark,OrbitWordmark} from '@/components/orbit/brand';
import {AppearanceSettings} from '@/components/orbit/appearance';
import './design.css';

export const dynamic='force-dynamic';
export default async function Design(){
  await requireChatGPTUser('/design');
  return <main className="design-library"><header className="design-top"><OrbitWordmark/><Link href="/" className="secondary-button">ORBIT으로 돌아가기</Link></header><section className="design-intro"><div><span className="design-kicker">ORBIT / DESIGN SYSTEM 01</span><h1>나를 중심으로,<br/>가능성은 궤도 위로.</h1><p>나의 페이스메이커를 위한 로고, 테마, 그리고 일관된 화면 언어.</p><div className="design-links"><a href="/brand/ORBIT_Design_Kit.zip" download className="primary-button">디자인 패키지 다운로드</a><a href="/brand/ORBIT_Design_Book.html" className="secondary-button">전체 디자인북 열기</a></div></div><div className="design-symbol"><OrbitMark size={200}/></div></section>
    <section className="design-theme"><div><span className="design-kicker">01 / APPEARANCE</span><h2>지금의 나에게 맞는 테마</h2><p>선택한 테마가 ORBIT 전체 화면에 적용됩니다.</p></div><AppearanceSettings/></section>
    <section><div className="design-section-title"><span className="design-kicker">02 / IDENTITY</span><h2>하나의 중심, 연결되는 궤도</h2></div><div className="design-logo-grid"><div className="design-logo-tile is-dark"><OrbitMark size={150}/><a href="/brand/orbit-symbol-dark.svg" download>다크 심볼 SVG ↓</a></div><div className="design-logo-tile is-light"><OrbitMark size={150}/><a href="/brand/orbit-symbol-light.svg" download>라이트 심볼 SVG ↓</a></div><div className="design-logo-tile"><img src="/brand/orbit-app-icon-1024.png" width="150" height="150" alt="ORBIT 앱 아이콘"/><a href="/brand/orbit-app-icon-1024.png" download>앱 아이콘 PNG ↓</a></div></div></section>
    <section><div className="design-section-title"><span className="design-kicker">03 / COLOR</span><h2>깊이와 선명함의 균형</h2></div><div className="design-palette">{[['Ink','#080B16'],['Navy','#11182A'],['Lavender','#9C8CFF'],['Cyan','#72DDF5'],['Cloud','#F4F6FF']].map(([name,hex])=><div key={name}><i style={{background:hex}}/><strong>{name}</strong><code>{hex}</code></div>)}</div></section>
    <section className="design-components"><div><span className="design-kicker">04 / INTERFACE</span><h2>다음 행동이 선명해지는 화면</h2><p>일정·프로젝트·지식과 대화가 같은 버튼, 대비, 여백을 공유합니다. 장식은 줄이고 현재 상태와 다음 행동을 드러냅니다.</p><div className="design-links"><a href="/demo#today" className="primary-button">예시 화면 둘러보기</a><a href="/brand/ORBIT_Design_System.md" download className="secondary-button">개발 적용 가이드</a></div></div><article className="design-example"><span className="design-kicker">컴포넌트 예시</span><h3>오늘의 가장 중요한 한 가지</h3><p>프로젝트의 다음 행동을 정리하세요.</p><div><span className="design-status">진행 중</span><span className="design-status is-complete">완료</span><span className="design-status is-waiting">검토 대기</span></div><div className="design-progress"><i/></div><small>진척도 예시 · 60%</small></article></section>
    <section><div className="design-section-title"><span className="design-kicker">05 / ART DIRECTION</span><h2>Higgsfield 브랜드 비주얼</h2></div><img className="design-board" src="/brand/orbit-identity-board.webp" width="1344" height="752" alt="Higgsfield로 제작한 ORBIT 브랜드 보드: 궤도 심볼, 워드마크, 앱 아이콘과 컬러"/></section>
    <footer className="design-footer"><OrbitWordmark/><span>ORBIT · 나의 페이스메이커</span><Link href="/">앱으로 돌아가기 ↗</Link></footer>
  </main>;
}
