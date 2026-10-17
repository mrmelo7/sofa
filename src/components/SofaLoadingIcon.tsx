import { useId } from "react";

/** Draws once, settles into its cushions, then rumbles, bounces and lights its buttons on a loop. */
export function SofaLoadingIcon({ size = 72 }: { size?: number }) {
  const id = useId();
  return (
    <svg
      className="sofa-loading-icon"
      width={size}
      height={size}
      viewBox="22 22 212 212"
      fill="none"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient
          id={`${id}-fabric`}
          x1="128"
          y1="72"
          x2="128"
          y2="174"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff3c66" />
          <stop offset="1" stopColor="#ef2d55" />
        </linearGradient>
        <linearGradient
          id={`${id}-seat`}
          x1="128"
          y1="122"
          x2="128"
          y2="156"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="#ff4e75" />
          <stop offset="1" stopColor="#f3335c" />
        </linearGradient>
      </defs>

      <g className="sofa-loading-fill">
        <path
          d="M39 158H61V173Q60 180 50 180Q40 180 39 173ZM195 158H217V173Q216 180 206 180Q196 180 195 173Z"
          fill="#d9254b"
        />
        <path
          d="M59 139Q128 128 197 139L199 167Q128 178 57 167Z"
          fill="#db244c"
        />
        <path
          d="M64 146Q128 153 192 146L191 164Q128 173 65 164Z"
          fill={`url(#${id}-fabric)`}
        />
        <g className="sofa-loading-cushions">
          <path
            d="M56 103Q58 78 76 74Q93 70 116 74Q128 75 127 85L125 113Q125 121 117 122L76 124Z"
            fill={`url(#${id}-fabric)`}
          />
          <path
            d="M129 83Q128 76 138 74Q159 69 180 74Q198 78 200 103L180 124L139 122Q131 122 131 114Z"
            fill={`url(#${id}-fabric)`}
          />
          <path
            d="M77 125Q128 118 179 125Q188 127 187 139L184 151Q128 161 72 151L69 140Q67 129 77 125Z"
            fill="#d92650"
          />
          <path
            d="M79 125Q128 120 177 125Q185 127 182 136Q178 144 128 144Q78 144 74 137Q71 129 79 125Z"
            fill={`url(#${id}-seat)`}
          />
          <path
            d="M75 144Q128 152 182 144L181 150Q128 159 75 150Z"
            fill="#f83b64"
          />
        </g>
        <g className="sofa-loading-arm">
          <path
            d="M55 99Q74 99 78 117Q82 136 69 160Q63 173 52 174Q36 175 32 161Q26 141 29 121Q32 101 55 99Z"
            fill={`url(#${id}-fabric)`}
          />
          <path
            d="M58 103Q73 105 76 120"
            stroke="#ff6585"
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M50 110H57Q61 110 61 114V121H68Q72 121 72 125V131Q72 135 68 135H61V142Q61 146 57 146H50Q46 146 46 142V135H39Q35 135 35 131V125Q35 121 39 121H46V114Q46 110 50 110Z"
            fill="#1c2330"
          />
        </g>
        <g className="sofa-loading-arm">
          <path
            d="M201 99Q224 101 227 121Q230 141 224 161Q220 175 204 174Q193 173 187 160Q174 136 178 117Q182 99 201 99Z"
            fill={`url(#${id}-fabric)`}
          />
          <path
            d="M188 106Q194 102 201 103"
            stroke="#ff6585"
            strokeOpacity="0.45"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <g className="sofa-loading-buttons" fill="#ffe8bd">
            <g>
              <circle cx="204" cy="116" r="5.6" />
            </g>
            <g>
              <circle cx="216" cy="128" r="5.6" />
            </g>
            <g>
              <circle cx="204" cy="140" r="5.6" />
            </g>
            <g>
              <circle cx="192" cy="128" r="5.6" />
            </g>
          </g>
        </g>
      </g>

      <g
        className="sofa-loading-outline"
        stroke="#ff6382"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path
          pathLength="1"
          d="M128 80Q120 70 89 73Q61 72 56 99Q32 100 29 121Q26 141 32 161Q34 170 40 173Q40 180 50 180Q60 180 61 173Q128 179 195 173Q196 180 206 180Q216 180 217 173Q222 170 224 161Q230 141 227 121Q224 101 200 99Q197 74 173 73Q140 69 128 80Z"
        />
        <path
          pathLength="1"
          d="M56 99Q78 99 78 123Q128 117 178 123Q178 99 200 99M128 80V120"
        />
        <path
          pathLength="1"
          d="M74 141Q128 149 182 141M69 158Q128 169 187 158"
        />
      </g>
    </svg>
  );
}
