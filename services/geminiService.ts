
import { GoogleGenAI, Type, Chat } from "@google/genai";
import { Topic, QuizQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-2.5-flash"; 

export const generateDailyTopics = async (day: number): Promise<Topic[]> => {
  try {
    const prompt = `为第 ${day} 天的学习计划生成 10 个 Unity 游戏开发面试知识点。
      
    要求：
    1. **极速响应**：概念解释必须**精炼**（控制在 50 字以内），不要长篇大论。
    2. **难度循序渐进**：前 3 个基础，中 4 个进阶，后 3 个底层/架构。
    3. **内容配比**：
       - 50% Unity (生命周期, 物理, 渲染, UI, ECS)
       - 30% C# (GC, 委托, 多线程, LINQ)
       - 20% 网络 (TCP/UDP, Socket, 同步)
    4. **代码示例**：必须简短且关键，必须包含换行符。

    请确保 JSON 返回格式正确。`;

    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              title: { type: Type.STRING, description: "标题" },
              category: { type: Type.STRING, enum: ["Unity", "C#", "Network"] },
              concept: { type: Type.STRING, description: "极简解释 (1-2句话)" },
              exampleCode: { type: Type.STRING, description: "核心代码片段 (带\\n)" },
              difficulty: { type: Type.STRING, enum: ["初级", "中级", "高级"] },
            },
            required: ["title", "concept", "difficulty", "category"],
          },
        },
      },
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as Topic[];
  } catch (error) {
    console.error("Error generating topics:", error);
    return [];
  }
};

export const generateQuiz = async (topics: Topic[]): Promise<QuizQuestion[]> => {
  const topicsContext = JSON.stringify(topics);
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下知识点创建 20 道面试题（简体中文）：
      ${topicsContext}
      
      要求：
      1. **代码格式**：JSON 字符串中必须用 \\n 换行。
      2. **题型多样**：单选、代码分析、判断、场景设计。
      3. **解析**：解释要精辟。`,
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
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating quiz:", error);
    return [];
  }
};

// Updated Comprehensive Exam to accept mistakes and dynamic count
export const generateComprehensiveQuiz = async (
  topicsSummary: string[], 
  previousMistakes: string[],
  questionCount: number
): Promise<QuizQuestion[]> => {
  try {
    // Cap question count to avoid timeouts (e.g., max 50)
    const safeCount = Math.min(questionCount, 50);
    
    const topicsStr = topicsSummary.join(", ");
    const mistakesStr = previousMistakes.length > 0 
      ? `重点考察错题领域：${previousMistakes.slice(0, 10).join("; ")}...` 
      : "全面考察。";

    const prompt = `生成 ${safeCount} 道 Unity 综合面试题。
    
    范围：${topicsStr}
    要求：
    1. ${mistakesStr}
    2. **代码格式**：使用 \\n 换行。
    3. 20% 底层原理，30% 代码阅读。
    
    返回 JSON。`;

    const response = await ai.models.generateContent({
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
    });

    const text = response.text;
    if (!text) return [];
    return JSON.parse(text) as QuizQuestion[];
  } catch (error) {
    console.error("Error generating comprehensive quiz:", error);
    return [];
  }
};

export const generateStudyNotes = async (topics: Topic[], quizScore: number): Promise<string> => {
  const topicsJson = JSON.stringify(topics);
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_SMART,
      contents: `学习内容：${topicsJson}。
      得分 ${quizScore}。
      生成 Markdown 学习笔记（简体中文）。
      
      要求：
      1. 结构清晰，标题明确。
      2. **代码块必须竖向排列**。
      3. 包含 "面试官常问" 和 "底层原理"。`,
    });
    
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
    const response = await chatSession!.sendMessage({ message });
    return response.text || "";
  } catch (error) {
    console.error("Chat error:", error);
    return "连接错误，请稍后再试。";
  }
};
