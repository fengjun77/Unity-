import { GoogleGenAI, Type, Chat } from "@google/genai";
import { Topic, QuizQuestion } from "../types";

const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

const MODEL_FAST = "gemini-2.5-flash";
const MODEL_SMART = "gemini-2.5-flash"; 

export const generateDailyTopics = async (day: number): Promise<Topic[]> => {
  try {
    // Updated prompt to include C# and Network
    const prompt = `为第 ${day} 天的学习计划生成 10 个 Unity 游戏开发面试知识点（使用简体中文）。
      
    请按照以下比例混合知识点：
    - 50% Unity 引擎 (生命周期, 物理, 渲染管线, UI, ECS 等)
    - 30% C# 语言特性 (内存管理, GC, 委托/事件, 多线程, LINQ 等)
    - 20% 计算机网络基础 (TCP/UDP, HTTP, Socket, 状态同步/帧同步)

    提供理论解释和实用的代码示例。
    重要：代码示例必须是多行的、格式良好的代码块，绝对不要写成一行。`;

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
              title: { type: Type.STRING, description: "知识点标题 (中文)" },
              category: { type: Type.STRING, enum: ["Unity", "C#", "Network"], description: "分类" },
              concept: { type: Type.STRING, description: "简明扼要的解释 (2-3句话，中文)" },
              exampleCode: { type: Type.STRING, description: "C# 代码片段 (必须包含换行符 \\n 以便竖向显示)" },
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
  const topicsSummary = topics.map(t => `${t.category}: ${t.title}`).join(", ");
  
  try {
    const response = await ai.models.generateContent({
      model: MODEL_FAST,
      contents: `基于以下 Unity/C#/网络 知识点创建 5 道单选面试题（使用简体中文）：${topicsSummary}。`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              question: { type: Type.STRING, description: "问题描述 (中文)" },
              options: { type: Type.ARRAY, items: { type: Type.STRING }, description: "4个选项的数组 (中文)" },
              correctIndex: { type: Type.INTEGER, description: "正确答案的索引 (0-3)" },
              explanation: { type: Type.STRING, description: "解析 (中文)" },
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

// New function for Comprehensive Exam
export const generateComprehensiveQuiz = async (allNotesContent: string): Promise<QuizQuestion[]> => {
  try {
    // Summarize the content briefly for the prompt to fit context if too large
    const context = allNotesContent.slice(0, 20000); // Safety limit

    const response = await ai.models.generateContent({
      model: MODEL_SMART, // Use smart model for better comprehensive questions
      contents: `我是 Unity 学习者。这是我过去学习的所有笔记摘要：
      ${context}
      
      请基于这些内容，生成 15 道综合性的、高难度的面试选择题（简体中文）。
      覆盖 Unity、C# 和 网络基础。`,
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
      contents: `我刚刚学习了这些知识点 (Unity/C#/Network)：${topicsJson}。
      测验得分 ${quizScore}/5。
      请生成一份详细的 Markdown 学习笔记（简体中文）。
      
      格式要求：
      1. 使用清晰的标题。
      2. **代码示例必须竖向排列**，使用多行代码块，不要压缩成一行。
      3. 包含 "面试官常问" 部分。
      4. 包含 C# 底层原理和网络同步机制的深入解释。`,
    });
    
    return response.text || "无法生成笔记。";
  } catch (error) {
    console.error("Error generating notes:", error);
    return "生成笔记时出错，请重试。";
  }
};

// Chat Session
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