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
  retries = 3, 
  backoff = 2000
): Promise<T> {
  try {
    return await fn();
  } catch (error: any) {
    const msg = error.toString().toLowerCase();
    const isRateLimit = msg.includes("429") || msg.includes("quota") || msg.includes("resource_exhausted") || error.status === 429;
    
    if (isRateLimit && retries > 0) {
      console.warn(`API Quota hit (429). Retrying in ${backoff}ms...`);
      await delay(backoff);
      return runWithRetry(fn, retries - 1, backoff * 2);
    }
    throw error;
  }
}

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
    const avoidContext = existingTitles.length > 0 
        ? `\n\n**重要提示**：前序已生成的知识点如下，请**绝对不要重复**，并确保新生成的内容与它们衔接自然：${existingTitles.join(" | ")}` 
        : "";

    let prompt = "";
    let categoryEnum = ["Unity", "C#", "Network"];

    if (track === 'UNITY') {
        prompt = `为第 ${day} 天的学习计划生成 ${count} 个 Unity 游戏开发面试知识点。
        本次生成序号：${startIndex} 到 ${startIndex + count - 1}。
        ${avoidContext}
        
        要求：
        1. **内容详尽**：包含该知识点的全部重要内容、底层原理、源码分析。
        2. **面试八股文**：concept 中必须包含 "### 面试必问" 章节，列出 2-3 个面试题。
        3. **难度分布**：序号 1-3 基础，4-7 进阶，8-10 底层架构。
        4. **代码示例**：C# 代码必须详细，使用 \\n 换行。`;
    } else {
        categoryEnum = ["C#", "Algorithm", "DataStructure"];
        prompt = `为第 ${day} 天的学习计划生成 ${count} 个 C# 高级编程与算法面试知识点。
        本次生成序号：${startIndex} 到 ${startIndex + count - 1}。
        ${avoidContext}

        重点领域：
        - C# 语言特性 (GC, 多线程, 反射, IL)
        - 常用数据结构 (Dictionary 底层, 链表, 树, 堆)
        - 经典算法 (排序, 寻路, 动态规划)
        
        要求：
        1. **深度优先**：解释 CLR 实现原理或算法的时间复杂度。
        2. **面试视角**：concept 中包含 "### 高频考点"。
        3. **代码示例**：必须提供完整的 C# 实现代码。`;
    }

    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt + "\n请确保 JSON 返回格式正确。",
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "标题" },
              category: { type: Type.STRING, enum: categoryEnum },
              concept: { type: Type.STRING, description: "详细解释 + 面试八股文 (Markdown)" },
              exampleCode: { type: Type.STRING, description: "完整代码片段 (带\\n)" },
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
  const topicsContext = JSON.stringify(topics.map(t => ({ title: t.title, concept: t.concept.substring(0, 500) }))); 
  
  try {
    const questionCount = topics.length * 2; // 2 questions per topic
    const response = await runWithRetry<GenerateContentResponse>(() => ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下知识点创建 ${questionCount} 道面试题（简体中文）：
      ${topicsContext}
      
      要求：
      1. **题量**：每个知识点对应 2 道题。
      2. **代码格式**：JSON 字符串中必须用 \\n 换行。
      3. **题型**：单选或代码输出预测。
      4. **解析**：解释要精辟，指出坑点。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "问题 (支持 Markdown 代码块)" },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "4个选项" },
              correctIndex: { type: Type.INTEGER, description: "0-3" },
              explanation: { type: Type.STRING, description: "解析" },
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
    
    const topicsStr = topicsSummary.join(", ");
    const mistakesStr = previousMistakes.length > 0 
      ? `重点考察错题领域：${previousMistakes.slice(0, 10).join("; ")}...` 
      : "全面考察。";

    const prompt = `生成 ${safeCount} 道面试题。
    
    范围：${topicsStr}
    要求：
    1. ${mistakesStr}
    2. **代码格式**：使用 \\n 换行。
    3. 20% 底层原理，30% 代码阅读。
    
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
      contents: `学习内容：${topicsJson}。
      得分 ${quizScore}。
      生成 Markdown 学习笔记（简体中文）。
      
      要求：
      1. 结构清晰，标题明确。
      2. **代码块必须竖向排列**。
      3. 包含 "面试官常问" 和 "底层原理" 总结。`,
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
      systemInstruction: "你是一位资深 Unity 架构师。精通 C# 底层、渲染管线和网络同步。回答必须使用简体中文。代码示例必须多行显示。",
    },
  });
};

export const sendMessageToChat = async (message: string): Promise<string> => {
  if (!chatSession) startChatSession();
  try {
    // For chat, we also want basic retry but usually chat is interactive so maybe less aggressive
    const response = await runWithRetry<GenerateContentResponse>(() => chatSession!.sendMessage({ message }), 2, 1000);
    return response.text || "";
  } catch (error) {
    console.error("Chat error:", error);
    return "连接错误或配额不足，请稍后再试。";
  }
};
