import {t} from '../lib/i18n';
import {Tooltip} from './Tooltip';
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Icon } from './Icon'
import './aspect-ratio-select.css'

export const commonAspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4', '4:5', '21:9'] as const

interface AspectRatioSelectProps {
  value: string
  onChange: (value: string) => void
  label?: string
  options?: readonly string[]
  className?: string
  compact?: boolean
}

export function AspectRatioPreview({ value }: { value: string }) {
  const [width, height] = value.split(':').map(Number)
  const ratio = Number.isFinite(width / height) && width > 0 && height > 0 ? width / height : 1
  const longestEdge = 17

  return (
    <span className="aspect-ratio-preview" aria-hidden="true">
      <span
        className="aspect-ratio-preview-shape"
        style={{
          width: ratio >= 1 ? longestEdge : longestEdge * ratio,
          height: ratio >= 1 ? longestEdge / ratio : longestEdge,
        }}
      />
    </span>
  )
}

export function AspectRatioSelect({
  value,
  onChange,
  label = t("Proporção"),
  options = commonAspectRatios,
  className = '',
  compact = false,
}: AspectRatioSelectProps) {
  return (
    <Dropdown.Root>
      <Tooltip content={label}><Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${value}`}
          className={`aspect-ratio-select ${compact ? 'is-compact' : ''} ${className}`}
        >
          <AspectRatioPreview value={value} />
          <span className="aspect-ratio-select-value">{value}</span>
          <Icon name="chevron-down" size={13} />
        </button>
      </Dropdown.Trigger></Tooltip>
      <Dropdown.Portal>
        <Dropdown.Content
          className="aspect-ratio-menu"
          align="start"
          sideOffset={7}
          collisionPadding={10}
          aria-label={label}
        >
          <Dropdown.RadioGroup value={value} onValueChange={onChange}>
            {options.map(ratio => (
              <Dropdown.RadioItem
                key={ratio}
                value={ratio}
                textValue={ratio}
                className="aspect-ratio-option"
              >
                <AspectRatioPreview value={ratio} />
                <span>{ratio}</span>
                <span className="aspect-ratio-option-check">
                  <Dropdown.ItemIndicator><Icon name="check" size={13} /></Dropdown.ItemIndicator>
                </span>
              </Dropdown.RadioItem>
            ))}
          </Dropdown.RadioGroup>
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}
