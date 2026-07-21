import { useState } from 'react'
import styles from '../app.module.css'

export function YouTubeDialog(props: {
  slot: 'a' | 'b'
  onSubmit: (url: string) => void
  onClose: () => void
}) {
  const [url, setUrl] = useState('')
  return (
    <div className={styles.backdrop} onClick={props.onClose}>
      <div className={styles.card} onClick={e => e.stopPropagation()}>
        <div className={styles.cardRow} style={{ marginBottom: 10 }}>
          <h2 className={styles.h2}>
            Load a YouTube video into source {props.slot.toUpperCase()}
          </h2>
          <button
            className={styles.btn}
            style={{ margin: 0 }}
            onClick={props.onClose}
          >
            close
          </button>
        </div>
        <p className={styles.helpText}>
          Paste a YouTube URL. It’s fetched locally with yt-dlp (dev only) and
          fed through the signal path like any other video. The first load
          downloads the clip, so it may take a moment.
        </p>
        <form
          className={styles.cardRow}
          onSubmit={e => {
            e.preventDefault()
            props.onSubmit(url)
          }}
        >
          <input
            className={styles.select}
            type="text"
            placeholder="https://youtube.com/watch?v=…"
            value={url}
            onChange={e => setUrl(e.target.value)}
            autoFocus
          />
          <button className={styles.btn} style={{ margin: 0 }} type="submit">
            Load
          </button>
        </form>
      </div>
    </div>
  )
}
