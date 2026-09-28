import { Icon } from './Icon';
import { Tooltip } from './ui';
import { t } from '../lib/i18n';
import './audio-toggle.css';

export function AudioToggle({enabled, disabled, onChange}: {enabled: boolean; disabled?: boolean; onChange: (enabled: boolean) => void}) {
  return <Tooltip content={t(enabled ? 'Desativar áudio' : 'Ativar áudio')}>
    <button type="button" className="audio-toggle" aria-label={t('Gerar áudio')} aria-pressed={enabled} disabled={disabled} onClick={() => onChange(!enabled)}>
      <Icon name={enabled ? 'volume' : 'volume-off'} size={17}/>
    </button>
  </Tooltip>;
}
