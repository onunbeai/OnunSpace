import * as Dropdown from '@radix-ui/react-dropdown-menu';
import { useI18n } from '../lib/i18n';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';
import './language-selector.css';

const languages = [
  { value: 'en', label: 'English', short: 'EN', flag: 'us' },
  { value: 'pt-BR', label: 'Português', short: 'PT', flag: 'br' },
] as const;

export function LanguageSelector() {
  const { locale, setLocale, t } = useI18n();
  const current = languages.find(language => language.value === locale)!;
  return <Dropdown.Root>
    <Tooltip content={t('Idioma')}><Dropdown.Trigger asChild><button className="language-selector" aria-label={t('Idioma')}><img src={`/assets/flags/${current.flag}.svg`} alt=""/><span>{current.short}</span><Icon name="chevron-down" size={11}/></button></Dropdown.Trigger></Tooltip>
    <Dropdown.Portal><Dropdown.Content className="language-menu" align="end" sideOffset={8}>
      <Dropdown.RadioGroup value={locale} onValueChange={value => { if (value === 'en' || value === 'pt-BR') setLocale(value); }}>
        {languages.map(language => <Dropdown.RadioItem className="language-menu-item" value={language.value} key={language.value}>
          <img src={`/assets/flags/${language.flag}.svg`} alt=""/><span>{language.label}</span><Dropdown.ItemIndicator className="language-menu-check"><Icon name="check" size={14}/></Dropdown.ItemIndicator>
        </Dropdown.RadioItem>)}
      </Dropdown.RadioGroup>
    </Dropdown.Content></Dropdown.Portal>
  </Dropdown.Root>;
}
