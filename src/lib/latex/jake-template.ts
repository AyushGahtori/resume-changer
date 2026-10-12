export const JAKE_STYLE_TEMPLATE = String.raw`\documentclass[letterpaper,10pt]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[letterpaper,top=0.45in,bottom=0.45in,left=0.55in,right=0.55in]{geometry}
\usepackage{enumitem}
\usepackage{hyperref}
\usepackage{tabularx}
\usepackage{titlesec}
\usepackage{lmodern}
\pagestyle{empty}
\setlength{\parindent}{0pt}
\setlength{\tabcolsep}{0pt}
\urlstyle{same}
\hypersetup{hidelinks}
\titleformat{\section}{\vspace{-4pt}\large\scshape\raggedright}{}{0em}{}[\titlerule\vspace{-5pt}]
\titlespacing*{\section}{0pt}{6pt}{4pt}
\setlist[itemize]{leftmargin=0.17in,itemsep=0pt,topsep=2pt,parsep=0pt,partopsep=0pt}

\newcommand{\ResumeHeader}[2]{%
  \begin{center}
    {\LARGE\textbf{#1}}\\[-2pt]
    {\small #2}
  \end{center}\vspace{-4pt}\hrule\vspace{4pt}
}
\newcommand{\ResumeProfileSummary}[2]{%
  \if\relax\detokenize{#1#2}\relax\else
    \if\relax\detokenize{#1}\relax\else\textbf{#1}\par\fi
    \if\relax\detokenize{#2}\relax\else #2\par\fi
    \vspace{4pt}
  \fi
}
\newcommand{\ResumeEntry}[4]{%
  \begin{tabularx}{\textwidth}{@{}Xr@{}}
    \textbf{#1} & {\small #2}\\
    {\small\textit{#3}} & {\small\textit{#4}}
  \end{tabularx}\vspace{-4pt}
}
\newcommand{\ResumeBulletListStart}{\begin{itemize}}
\newcommand{\ResumeBulletListEnd}{\end{itemize}\vspace{-4pt}}
\newcommand{\ResumeSkillGroup}[2]{\textbf{#1:} #2\\}
\newcommand{\ResumeCredential}[2]{%
  \begin{tabularx}{\textwidth}{@{}Xr@{}}
    {\small #1} & {\small #2}
  \end{tabularx}\vspace{-2pt}
}

\begin{document}
%%RESUME_CONTENT%%
\end{document}
`;

export function applyJakeStyleTemplate(content: string): string {
  const marker = "%%RESUME_CONTENT%%";
  const markerIndex = JAKE_STYLE_TEMPLATE.indexOf(marker);

  if (
    markerIndex < 0 ||
    JAKE_STYLE_TEMPLATE.indexOf(marker, markerIndex + 1) >= 0
  ) {
    throw new Error(
      "The LaTeX template must contain exactly one content marker.",
    );
  }

  return JAKE_STYLE_TEMPLATE.replace(marker, content);
}
