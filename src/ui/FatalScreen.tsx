import shared from '../app.module.css'
import { cx } from './cx'
import styles from './FatalScreen.module.css'

export interface Fatal {
  title: string
  body: string
  kind: 'unavailable' | 'lost'
}

export function FatalScreen({ fatal }: { fatal: Fatal }) {
  return (
    <div className={styles.fatalWrap}>
      <div className={styles.fatalCard}>
        <h1 className={styles.fatalTitle}>{fatal.title}</h1>
        <p style={{ margin: '0 0 14px' }}>{fatal.body}</p>
        {fatal.kind === 'unavailable' ? (
          <>
            <p className={shared.muted} style={{ margin: '0 0 14px' }}>
              This app renders the entire NTSC signal path in WebGPU compute
              shaders, so a WebGPU-capable browser with working hardware
              acceleration is required — there is no 2D-canvas fallback.
            </p>
            <p className={shared.muted} style={{ margin: 0 }}>
              Check support at{' '}
              <a
                className={shared.link}
                href="https://caniuse.com/webgpu"
                target="_blank"
                rel="noreferrer"
              >
                caniuse.com/webgpu
              </a>
              .
            </p>
          </>
        ) : (
          <button
            className={cx(shared.btn, shared.active)}
            onClick={() => location.reload()}
          >
            reload
          </button>
        )}
      </div>
    </div>
  )
}
