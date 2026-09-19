import type {CSSProperties} from 'react';

/** One geometric master for navigation, app identity and small UI marks. */
export function OrbitMark({size=36,className='',style}:{size?:number;className?:string;style?:CSSProperties}) {
  return <svg className={`orbit-mark ${className}`} width={size} height={size} viewBox="0 0 100 100" fill="none" aria-hidden="true" style={style}>
    <circle cx="50" cy="50" r="28" stroke="currentColor" strokeWidth="10"/>
    <ellipse cx="50" cy="50" rx="46" ry="13" transform="rotate(-32 50 50)" stroke="var(--orbit-logo-accent, #9C8CFF)" strokeWidth="2.5"/>
    <circle cx="86" cy="23" r="5" fill="var(--orbit-logo-accent, #9C8CFF)"/>
  </svg>;
}

export function OrbitWordmark(){return <span className="orbit-wordmark"><OrbitMark/><span>ORBIT</span></span>}
