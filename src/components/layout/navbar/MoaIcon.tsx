/** Small, static portrait: available even before the optional companion loads. */
export const MoaIcon = ({ className }: { className?: string }) => (
  <svg
    className={className}
    width="23"
    height="26"
    viewBox="0 0 32 36"
    fill="none"
    aria-hidden="true"
  >
    <path
      d="M8 3h16l4 5v16l3 5-5 4H6l-5-4 3-5V8z"
      fill="#aeb5bb"
      stroke="#253a47"
      strokeWidth="2"
    />
    <path d="M9 5h13l3 3H8z" fill="#dde4e7" />
    <path d="M8 13l5-2 1 2-6 2m10-2 5-2 1 2-6 2" stroke="#43515c" strokeWidth="2" />
    <path d="M11 17v4m10-4v4" stroke="#233340" strokeWidth="3" strokeLinecap="round" />
    <path d="M12 24q4 4 8 0" stroke="#344957" strokeWidth="1.5" strokeLinecap="round" />
    <path d="M11 30q4-5 8-1l-3 2q5 1 7-2" stroke="#087c98" strokeWidth="2" strokeLinecap="round" />
  </svg>
);
