import React, { useId } from 'react';

interface ProMoneyLogoProps {
  variant?: 'full' | 'icon' | 'compact';
  size?: 'sm' | 'md' | 'lg';
  surface?: 'light' | 'orange' | 'dark';
  className?: string;
}

export const ProMoneyLogo: React.FC<ProMoneyLogoProps> = ({
  variant = 'full',
  size = 'md',
  surface = 'light',
  className = '',
}) => {
  const uid = useId().replace(/:/g, '');
  const gradId = `pmGrad-${uid}`;
  const iconDim = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9';
  const textSize = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-xl' : 'text-[17px]';
  const isOrangeSurface = surface === 'orange';

  return (
    <div className={`inline-flex items-center gap-2.5 select-none shrink-0 ${className}`}>
      <svg
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`${iconDim} shrink-0 drop-shadow-[0_1px_2px_rgba(15,23,42,0.12)]`}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#FF7A1A" />
            <stop offset="100%" stopColor="#EA580C" />
          </linearGradient>
        </defs>
        <rect
          width="64"
          height="64"
          rx="16"
          fill={isOrangeSurface ? '#FFFFFF' : `url(#${gradId})`}
        />
        <rect
          x="1.25"
          y="1.25"
          width="61.5"
          height="61.5"
          rx="14.75"
          stroke={isOrangeSurface ? '#FED7AA' : '#FFFFFF'}
          strokeOpacity={isOrangeSurface ? '0.95' : '0.28'}
          strokeWidth="1.5"
        />
        {/* Architectural P Pillar */}
        <path
          d="M15 47V17H28.5C34.8 17 39 20.8 39 26.5C39 32.2 34.8 36 28.5 36H21.5V47H15ZM21.5 30.2H27.8C30.8 30.2 32.6 28.7 32.6 26.5C32.6 24.3 30.8 22.8 27.8 22.8H21.5V30.2Z"
          fill={isOrangeSurface ? '#EA580C' : '#FFFFFF'}
        />
        {/* Kinetic M Prism */}
        <path
          d="M33.5 47L41 27L49 47H42.6L41 41.5L39.4 47H33.5Z"
          fill="#0F172A"
        />
        {/* Apex Highlight Triangle */}
        <path
          d="M36.5 17H49L42.75 27.5L36.5 17Z"
          fill={isOrangeSurface ? '#F97316' : '#FEF3C7'}
        />
      </svg>

      {variant !== 'icon' && (
        <div className="flex flex-col leading-none">
          <span
            className={`font-display font-extrabold tracking-tight whitespace-nowrap shrink-0 ${textSize} ${
              isOrangeSurface
                ? 'text-white'
                : 'text-slate-900 dark:text-zinc-50'
            }`}
          >
            PRO{' '}
            <span className={isOrangeSurface ? 'text-orange-100' : 'text-[#EA580C] dark:text-[#FB923C]'}>
              MONEY
            </span>
          </span>
        </div>
      )}
    </div>
  );
};
