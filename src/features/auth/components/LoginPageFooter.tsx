import React from 'react';

interface LoginPageFooterProps {
  isDayGradient: boolean;
}

export const LoginPageFooter: React.FC<LoginPageFooterProps> = ({ isDayGradient }) => (
  <div className="mt-4 text-center animate-login-reveal animate-login-reveal-delay-3">
    <p
      className={`text-[10px] font-bold uppercase tracking-widest ${
        isDayGradient ? 'text-white/78' : 'text-slate-200'
      }`}
    >
      V 3.0
    </p>
    <p className={`mt-1 text-[9px] ${isDayGradient ? 'text-white/72' : 'text-slate-300'}`}>
      Desarrollo: daniel.opazo@hospitalhangaroa.cl
    </p>
    <p className={`text-[9px] ${isDayGradient ? 'text-white/72' : 'text-slate-300'}`}>
      Rapa Nui, Chile
    </p>
  </div>
);
