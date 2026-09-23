import styles from './SettingsOverlay.module.css'

export default function SettingsOverlay({ onClose }) {
  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.handle} />

        <h2 className={styles.title}>Settings</h2>

        <div className={styles.section}>
          <div className={styles.sectionLabel}>ACCESS</div>
          <div className={styles.keyDisplay}>Tailscale network only</div>
        </div>

        <button type="button" className={styles.doneBtn} onClick={onClose}>
          Done
        </button>
      </div>
    </div>
  )
}
