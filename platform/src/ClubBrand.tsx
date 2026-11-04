/** Modular D mark, traced as geometry from the supplied DBC VI reference. */
export function ClubMark(){return <svg className="club-mark" viewBox="0 0 84 100" fill="currentColor" aria-hidden="true"><path d="M0 0h18v18H0zM0 20h18v18H0zM0 40h18v18H0zM0 60h18v18H0zM0 80h18v20H0zM20 0h46l18 18v16L58 50V20H20zM58 54l26-16v44l-18 18H20V80h38z"/></svg>}
export function ClubBrand(){return <a className="brand" href="/" aria-label="Duke Blockchain Club · Agent Exchange"><ClubMark/><span className="club-wordmark">DUKE<span>BLOCKCHAIN CLUB</span><small>AGENT EXCHANGE</small></span></a>}
export function ModuleGrid(){return <div className="module-art" aria-hidden="true">{Array.from({length:24},(_,i)=><i key={i}/>)}</div>}
