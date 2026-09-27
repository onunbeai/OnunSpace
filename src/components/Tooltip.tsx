import type {ReactElement} from 'react';
import * as Primitive from '@radix-ui/react-tooltip';
import './tooltip.css';

export const TooltipProvider=Primitive.Provider;

export function Tooltip({content,children,side='top'}:{content:string;children:ReactElement;side?:'top'|'right'|'bottom'|'left'}) {
 return <Primitive.Root>
  <Primitive.Trigger asChild>{children}</Primitive.Trigger>
  <Primitive.Portal><Primitive.Content className="ui-tooltip" side={side} sideOffset={9} collisionPadding={10}>
   {content}
  </Primitive.Content></Primitive.Portal>
 </Primitive.Root>;
}
