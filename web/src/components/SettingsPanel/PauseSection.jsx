import { useState, useEffect } from 'react'
import { setPauseAllRules, subscribeToPauseAllRules } from '@kidscontrol/shared/data/profile'
import { useRulesStore } from '@kidscontrol/shared/stores/useRulesStore'

export default function PauseSection() {
  const { user, activeOwnerUid } = useRulesStore()
  const ownerUid = activeOwnerUid || user?.uid
  const [paused, setPaused] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!ownerUid) return
    return subscribeToPauseAllRules(ownerUid, setPaused)
  }, [ownerUid])

  const toggle = async () => {
    if (!ownerUid || saving) return
    setSaving(true)
    try {
      await setPauseAllRules(ownerUid, !paused)
      setPaused(!paused)
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="settings-section">
      <div className="settings-section-header">
        <div className="settings-section-icon">🔓</div>
        <div>
          <h2 className="settings-section-title">Экстренное снятие блокировок</h2>
          <p className="settings-section-desc">Временно отключает все ограничения на всех устройствах сразу</p>
        </div>
      </div>

      <div className={`pause-card ${paused ? 'pause-card--active' : ''}`}>
        <div className="pause-card-body">
          <div className="pause-card-info">
            <div className="pause-card-title">
              {paused ? 'Все блокировки сняты' : 'Блокировки активны'}
            </div>
            <div className="pause-card-desc">
              {paused
                ? 'Агенты на всех устройствах не применяют никаких правил. Включите снова, чтобы восстановить ограничения.'
                : 'Все правила и расписания работают в штатном режиме на всех подключённых устройствах.'}
            </div>
          </div>
          <button
            className={`pause-toggle ${paused ? 'pause-toggle--on' : ''}`}
            onClick={toggle}
            disabled={saving}
            aria-pressed={paused}
          >
            <span className="pause-toggle-knob" />
          </button>
        </div>

        {paused && (
          <div className="pause-warning">
            Блокировки отключены — ребёнок может использовать все программы и сайты без ограничений
          </div>
        )}
      </div>
    </section>
  )
}
