import Select from '../Select/Select'
import TimeInput from '../TimeInput/TimeInput'

const DAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

export default function ScheduleEditor({
  actionText,
  addGroupRange,
  addScheduleGroup,
  onIconChange,
  onNameChange,
  onSave,
  onToggleDisabled,
  profileDisabled,
  profileIcon,
  profileIcons,
  profileTitle,
  removeGroupRange,
  removeScheduleGroup,
  saving,
  schedule,
  toggleGroupDay,
  updateGroupRange,
  updateSchedule
}) {
  return (
    <>
      <div className="profile-schedule-header">
        <div className="profile-schedule-main">
          <div className="profile-title-row">
            <span className="profile-kicker">Расписание</span>
            <span className="profile-desc">{actionText}</span>
          </div>
          <div className="profile-identity-row">
            <input
              className="input profile-name-input"
              value={profileTitle}
              onChange={(event) => onNameChange(event.target.value)}
              placeholder="Название режима"
            />
            <div className="profile-icon-picker">
              {profileIcons.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  className={`profile-icon-choice ${profileIcon === icon ? 'active' : ''}`}
                  onClick={() => onIconChange(icon)}
                >
                  {icon}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="profile-header-actions">
          <label className="profile-mode-toggle-wrap" title={profileDisabled ? 'Режим отключён — нажмите, чтобы включить' : 'Режим включён — нажмите, чтобы отключить'}>
            <span className="profile-mode-toggle-label">{profileDisabled ? 'Выключен' : 'Включён'}</span>
            <span
              className={`profile-mode-toggle ${profileDisabled ? 'off' : 'on'}`}
              role="switch"
              aria-checked={!profileDisabled}
              tabIndex={0}
              onClick={onToggleDisabled}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggleDisabled() }}
            />
          </label>
          <button className="btn btn-primary profile-save-btn" onClick={onSave} disabled={saving}>
            {saving ? <span className="btn-spinner-sm" /> : 'Сохранить режим'}
          </button>
        </div>
      </div>

      <div className="profile-schedule-grid profile-schedule-compact">
        <div className="profile-groups">
          {schedule.groups.map((group, groupIndex) => (
            <div className="profile-group-row" key={groupIndex}>
              <div className="profile-group-action">
                <label className="profile-label">Окна</label>
                <Select
                  value={group.action}
                  onChange={value => updateSchedule(prev => ({
                    ...prev,
                    groups: prev.groups.map((currentGroup, index) =>
                      index === groupIndex ? { ...currentGroup, action: value } : currentGroup
                    )
                  }))}
                  options={[
                    { value: 'allow', label: 'Разрешать в эти окна' },
                    { value: 'block', label: 'Блокировать в эти окна' }
                  ]}
                  style={{ width: '100%' }}
                />
              </div>

              <div className="profile-group-days">
                <label className="profile-label">Дни</label>
                <div className="profile-days">
                  {DAYS.map((day, dayIndex) => (
                    <button
                      key={day}
                      type="button"
                      className={`profile-day ${group.weekdays.includes(dayIndex) ? 'active' : ''}`}
                      onClick={() => toggleGroupDay(groupIndex, dayIndex)}
                    >
                      {day}
                    </button>
                  ))}
                </div>
              </div>

              <div className="profile-group-ranges">
                <label className="profile-label">Время</label>
                <div className="profile-ranges">
                  {group.ranges.map((range, rangeIndex) => (
                    <div className="profile-range-row" key={`${groupIndex}-${rangeIndex}-${range.timeFrom}-${range.timeTo}`}>
                      <TimeInput
                        value={range.timeFrom}
                        onChange={timeFrom => updateGroupRange(groupIndex, rangeIndex, { timeFrom })}
                      />
                      <span className="time-sep">—</span>
                      <TimeInput
                        value={range.timeTo}
                        onChange={timeTo => updateGroupRange(groupIndex, rangeIndex, { timeTo })}
                      />
                      <button
                        className="btn btn-sm profile-range-remove"
                        onClick={() => removeGroupRange(groupIndex, rangeIndex)}
                        disabled={group.ranges.length === 1}
                        title="Удалить окно"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  <button className="btn btn-sm profile-add-range" onClick={() => addGroupRange(groupIndex)}>
                    + Время
                  </button>
                </div>
              </div>

              <button
                className="btn btn-sm profile-group-remove"
                onClick={() => removeScheduleGroup(groupIndex)}
                disabled={schedule.groups.length === 1}
                title="Удалить группу дней"
              >
                ×
              </button>
            </div>
          ))}
          <button className="btn btn-sm profile-add-group" onClick={addScheduleGroup}>
            + Группа дней
          </button>
        </div>
      </div>
    </>
  )
}
