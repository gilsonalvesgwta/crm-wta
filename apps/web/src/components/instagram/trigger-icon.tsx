import { AtSign, Heart, MessageCircle, MessageSquareText, Radio, Reply } from 'lucide-react';
import type { TriggerType } from '@/lib/instagram';
import { TRIGGER_TONE } from './tabs';

const ICONS: Record<TriggerType, typeof MessageCircle> = {
  comment: MessageCircle,
  dm_keyword: MessageSquareText,
  live_comment: Radio,
  story_reply: Reply,
  story_mention: AtSign,
  reaction: Heart,
};

export function TriggerIcon({ type, size = 36 }: { type: TriggerType; size?: number }) {
  const I = ICONS[type];
  return (
    <span aria-hidden style={{ width: size, height: size }} className={`inline-flex shrink-0 items-center justify-center rounded-[8px] ${TRIGGER_TONE[type]}`}>
      <I size={Math.round(size * 0.5)} strokeWidth={1.9} />
    </span>
  );
}
