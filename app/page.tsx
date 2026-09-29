'use client';

import dynamic from 'next/dynamic';
import { TooltipProvider } from '@/components/ui/tooltip';

const NagomiPond = dynamic(
  () => import('@/nagomi-app').then((mod) => mod.App),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-screen w-screen items-center justify-center bg-[#09090b] text-[#a1a1aa] font-sans text-sm tracking-wide">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 rounded-full border-2 border-[#52525b] border-t-emerald-400 animate-spin" />
          <span className="font-light tracking-wider text-xs uppercase text-[#d4d4d8]">Entering Nagomi Pond...</span>
        </div>
      </div>
    ),
  }
);

export default function Page() {
  return (
    <div id="root" className="dark w-full h-full min-h-screen bg-[#09090b] overflow-hidden select-none">
      <TooltipProvider>
        <NagomiPond />
      </TooltipProvider>
    </div>
  );
}
