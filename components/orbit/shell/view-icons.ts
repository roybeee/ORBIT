import {AlertCircle,BookOpen,CalendarDays,CheckCheck,Clock3,Database,Download,FolderKanban,Headphones,Inbox,Layers,LayoutGrid,Library,MessagesSquare,Mic,Moon,Network,Orbit,Sparkles,Sun,Target,Users,FlaskConical,Presentation,type LucideIcon} from 'lucide-react';
import type {View} from '@/lib/orbit/model';
import type {AreaId} from '@/lib/orbit/navigation';

export const viewIcons:Record<View,LucideIcon>={
 today:Sun,calendar:CalendarDays,review:Moon,proposal:Sparkles,dashboard:LayoutGrid,voice:Mic,
 inbox:Inbox,followup:CheckCheck,
 agent:MessagesSquare,aside:Network,
 projects:FolderKanban,tasks:CheckCheck,goals:Target,portfolio:Layers,signals:AlertCircle,meetings:Presentation,experiments:FlaskConical,contacts:Users,
 wiki:BookOpen,knowledge:Library,understanding:Sparkles,monthly:Layers,learning:Sparkles,
 automation:Clock3,sound:Headphones,data:Database,backup:Download,
};
export const areaIcons:Record<AreaId,LucideIcon>={today:Sun,inbox:Inbox,orbit:Orbit,projects:FolderKanban,library:BookOpen,me:Users};
