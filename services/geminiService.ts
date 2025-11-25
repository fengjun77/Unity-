import { GoogleGenAI, Type, Chat, GenerateContentResponse } from "@google/genai";
import { Topic, QuizQuestion, TrackType } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-2.5-flash"; 

// Helper: Wait function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Wraps an API call with retry logic for handling Rate Limit (429) errors.
 */
async function runWithRetry<T>(
  fn: () => Promise<T>, 
  retries = 5, 
  backoff = 5000 
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    let msg = "";
    try {
        if (typeof error === 'object') {
            msg = JSON.stringify(error).toLowerCase();
            if (error?.error?.message) msg += error.error.message.toLowerCase();
        } else {
            msg = String(error).toLowerCase();
        }
    } catch (e) {
        msg = "unknown error";
    }

    const isRateLimit = 
      msg.includes("429") || 
      msg.includes("quota") || 
      msg.includes("resource_exhausted") || 
      error?.status === 429 ||
      error?.code === 429 ||
      error?.error?.code === 429 || 
      error?.error?.status === "RESOURCE_EXHAUSTED";
    
    if (isRateLimit && retries > 0) {
      await delay(backoff);
      return runWithRetry(fn, retries - 1, backoff * 2);
    }
    throw error;
  }
}

// --- HARDCODED CURRICULUM MAP (The "Brain" of the learning path) ---
const UNITY_DAILY_PLAN: Record<number, string> = {
    6:  "**主题：背包系统 (一) - 数据架构**。重点讲解 ScriptableObject 存储物品数据、ItemDatabase 设计、JSON 数据读取。案例：RPG 物品数据库。",
    7:  "**主题：背包系统 (二) - UI 与 交互**。重点讲解 Grid Layout Group、Scroll Rect、IDragHandler (拖拽接口)、Canvas Raycast。案例：将物品从背包拖到装备栏。",
    8:  "**主题：任务系统 (Quest System)**。重点讲解 任务数据结构 (Graph/List)、观察者模式 (Observer Pattern) 监听怪物死亡/物品获取。案例：'杀10只怪'的任务追踪。",
    9:  "**主题：对话系统 (Dialogue)**。重点讲解 逐字打印效果 (Coroutine)、对话树分支逻辑、UI 文本解析。案例：文字冒险游戏对话框。",
    10: "**主题：角色控制与状态机 (FSM)**。重点讲解 有限状态机 (Idle/Walk/Attack)、Animator Controller Layers、Blend Tree。案例：第三人称角色动作切换。",
    11: "**主题：对象池 (Object Pooling)**。重点讲解 内存碎片问题、Queue 数据结构管理对象、预实例化。案例：无限射击的子弹管理。",
    12: "**主题：数据持久化 (Save/Load)**。重点讲解 PlayerPrefs 局限性、JsonUtility、二进制序列化、存档加密基础。案例：保存游戏进度和玩家位置。",
    13: "**主题：小地图与导航 (Minimap)**。重点讲解 RenderTexture 制作小地图、坐标映射算法 (3D世界转2D UI)、Fog of War (战争迷雾)。案例：RTS 游戏小地图。",
    14: "**主题：技能系统 (Skill System)**。重点讲解 策略模式 (Strategy Pattern) 实现不同技能效果、冷却时间 (Cooldown) 管理、技能树 UI 连接线算法。",
    15: "**主题：音频管理 (Audio Manager)**。重点讲解 AudioMixer、音效优先级、单例模式管理音频、空间音效 (Spatial Blend)。案例：脚步声与环境音效。",
    16: "**主题：基础 AI 与 寻路**。重点讲解 NavMesh Agent、A* 算法原理、视线检测 (Dot Product)。案例：敌人巡逻与追击。",
    17: "**主题：设计模式实战**。重点讲解 单例模式 (Singleton)、工厂模式 (Factory)、命令模式 (Command - 用于回放系统)。",
    18: "**主题：性能优化 (一)**。重点讲解 Draw Calls (Batching)、GC (Garbage Collection) 避免、Profiler 使用。",
    19: "**主题：网络同步基础**。重点讲解 帧同步 vs 状态同步、UDP vs TCP、简单的 Socket 连接。案例：双人位置同步。",
    20: "**主题：渲染基础与特效**。重点讲解 Shader Graph 基础、粒子系统 (Particle System)、后处理 (Post Processing)。"
};

/**
 * Returns specific curriculum instructions based on the current day for Unity Track.
 */
const getUnityCurriculum = (day: number): string => {
    // 1. Check strict daily plan first
    if (UNITY_DAILY_PLAN[day]) {
        return `
        **今日核心主题：${UNITY_DAILY_PLAN[day]}**
        
        请完全围绕上述主题生成知识点。
        如果该主题比较复杂（如背包系统），请将其拆解为多个子知识点（例如：知识点1是数据结构，知识点2是UI布局，知识点3是拖拽逻辑）。
        不要偏题，不要生成不相关的基础知识。
        `;
    }

    // 2. Fallback to phases
    if (day <= 5) {
        return `
        **当前阶段：Unity 基础与 2D 游戏入门 (Day 1-5)**
        - 重点生成：MonoBehaviour 生命周期、Transform 坐标变换、Input 输入系统、Rigidbody2D/Collider2D 物理碰撞。
        - **目标**：能制作 Flappy Bird 或 简单的 2D 移动控制。
        `;
    } else {
        return `
        **当前阶段：高级架构与独立游戏实战 (Day 21+)**
        - 重点生成：AssetBundle 热更、Lua 脚本交互、ECS (DOTS)、URP 管线定制。
        - **目标**：独立游戏上线级别的技术储备。
        `;
    }
};

/**
 * Generates a batch of topics.
 */
export const generateTopicBatch = async (
  day: number, 
  startIndex: number, 
  count: number,
  existingTitles: string[] = [],
  track: TrackType = 'UNITY'
): Promise<Topic[]> => {
  try {
    const exclusionList = existingTitles.length > 0 
        ? existingTitles.join(" | ")
        : "无";

    const avoidContext = existingTitles.length > 0 
        ? `\n\n**【绝对禁止重复】**\n以下知识点已学过，**严禁**再次生成同名或高度相似的内容：\n[${exclusionList}]\n如果今日主题是“背包”，而列表中已有“背包数据”，则请生成“背包UI”或“背包拖拽”，不要重复讲数据。` 
        : "";

    let prompt = "";
    let categoryEnum = ["Unity", "C#", "Network"];

    if (track === 'UNITY') {
        const curriculum = getUnityCurriculum(day);
        
        prompt = `你是 Unity 游戏开发导师。第 ${day} 天任务：生成 ${count} 个 Unity 知识点。
        序号：${startIndex} - ${startIndex + count - 1}。
        ${avoidContext}
        
        ${curriculum}

        **内容格式要求 (必须严格遵守)**：
        1. **Markdown 排版**：
           Concept 字段内容必须清晰，使用 Markdown 标题 (###) 分隔章节。
           必须包含：
           - **### 📘 概念解析**
           - **### 🎮 游戏实战案例** (必须具体：例如"在制作 RPG 背包时...")
           - **### 💻 核心代码/算法** (代码必须换行)
           - **### ⚠️ 易错点/面试坑**
        2. **拆解复杂系统**：如果讲系统（如背包），不要试图在一个知识点讲完。知识点1讲ScriptableObject，知识点2讲UI Grid。
        3. **代码格式**：JSON 字符串中的代码必须使用 \\n 换行，并包含 // 注释。
        `;
    } else {
        categoryEnum = ["C#", "Algorithm", "DataStructure"];
        prompt = `你是 C# 与算法导师。第 ${day} 天任务：生成 ${count} 个 C# 或 算法知识点。
        序号：${startIndex} - ${startIndex + count - 1}。
        ${avoidContext}

        **格式要求 (Strict Formatting)**：
        1. **Concept 内容**：必须使用 Markdown 标题 (###) 分隔。
           - **### 核心概念**
           - **### 底层原理** (GC, IL, 内存布局)
           - **### 代码演示 / 算法思路**
           - **### 复杂度 (Time/Space)**
        2. **代码规范**：JSON 中的 exampleCode 必须是多行的、带缩进的、可编译的 C# 代码。不要写成一行！
        
        请返回 JSON 数组。`;
    }

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "标题 (如：背包系统-数据结构)" },
              category: { type: Type.STRING, enum: categoryEnum },
              concept: { type: Type.STRING, description: "Markdown 内容 (注意换行)" },
              exampleCode: { type: Type.STRING, description: "C# 代码 (必须用 \\n 换行)" },
              difficulty: { type: Type.STRING, enum: ["初级", "中级", "高级"] },
            },
            required: ["title", "concept", "difficulty", "category"],
          },
        },
      },
    }));

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as Topic[];
  } catch (error) {
    console.error("Error generating topic batch:", error);
    return [];
  }
};

/**
 * Generates quiz questions specifically for the provided list of topics.
 */
export const generateQuizForBatch = async (topics: Topic[]): Promise<QuizQuestion[]> => {
  if (topics.length === 0) return [];
  const topicsContext = JSON.stringify(topics.map(t => ({ title: t.title, concept: t.concept.substring(0, 300) }))); 
  
  try {
    const questionCount = topics.length * 2; 
    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下 Unity/C# 知识点生成 ${questionCount} 道面试题：
      ${topicsContext}
      
      要求：
      1. 结合游戏场景（例如：怪物追击时，为什么用 A* 而不用 Dijkstra？）。
      2. 包含代码阅读题。
      3. 解析要详细。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "correctIndex", "explanation"],
          },
        },
      },
    }));

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating quiz batch:", error);
    return [];
  }
};

export const generateComprehensiveQuiz = async (
  topicsSummary: string[], 
  previousMistakes: string[],
  questionCount: number
): Promise<QuizQuestion[]> => {
  try {
    const safeCount = Math.min(questionCount, 50);
    const mistakesStr = previousMistakes.length > 0 
      ? `优先考察之前的错题：${previousMistakes.slice(0, 10).join("; ")}` 
      : "全面考察";

    const prompt = `生成 ${safeCount} 道 Unity/C# 汇总面试题。
    范围：${topicsSummary.join(", ")}
    要求：
    1. ${mistakesStr}
    2. 难度：中高级。包含 算法题、架构设计题、底层原理题。
    返回 JSON。`;

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_SMART, 
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING },
              options: { type: Type.ARRAY, items: { type: Type.STRING } },
              correctIndex: { type: Type.INTEGER },
              explanation: { type: Type.STRING },
            },
            required: ["question", "options", "correctIndex", "explanation"],
          },
        },
      },
    }));

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating comprehensive quiz:", error);
    return [];
  }
};

export const generateStudyNotes = async (topics: Topic[], quizScore: number): Promise<string> => {
  const topicsJson = JSON.stringify(topics.map(t => ({ title: t.title, concept: t.concept.substring(0, 1000) })));
  
  try {
    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_SMART,
      contents: `整理学习笔记。内容：${topicsJson}。
      得分：${quizScore}。
      
      要求：
      1. 使用标准 Markdown。
      2. 每个知识点都要有 "实战案例" 总结。
      3. 代码块必须格式化良好。
      `,
    }));
    
    return response.text || "无法生成笔记。";
  } catch (error) {
    console.error("Error generating notes:", error);
    return "生成笔记时出错，请重试。";
  }
};

let chatSession: Chat | null = null;

export const startChatSession = () => {
  chatSession = ai.chats.create({
    model: MODEL_FAST,
    config: {
      systemInstruction: "你是一位资深 Unity 架构师。回答必须使用简体中文。解释知识点时，请结合具体游戏案例（如：在 MMO 中...，在 FPS 中...）。代码示例必须多行显示。",
    },
  });
};

export const sendMessageToChat = async (message: string): Promise<string> => {
  if (!chatSession) startChatSession();
  try {
    const response = await runWithRetry<GenerateContentResponse>(() => chatSession!.sendMessage({ message }), 2, 2000);
    return response.text || "";
  } catch (error) {
    console.error("Chat error:", error);
    return "连接错误或配额不足，请稍后再试。";
  }
};