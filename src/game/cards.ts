/**
 * 《风声》实体牌组清单
 *
 * 来源：六张实体牌照片逐张审计，并经人工复核确认。
 * 权威基线：
 * - 总牌数：87
 * - 红：21
 * - 蓝：21
 * - 黑：42
 * - 红蓝双色：3
 * - 带方向圈：28
 */

export type CardColor = "红" | "蓝" | "黑" | "红蓝";
export type TransmissionMethod = "密电" | "文本" | "直达" | "任意";
export type Faction = "军情" | "潜伏" | "特工";
export type ProbeCode = "好人" | "卧底" | "间谍";
export type SecretOrderWord = "听风" | "看雨" | "日落";
export type SingleColor = "红" | "蓝" | "黑";

export type CardVariant =
  | {
      kind: "probeIdentity";
      mapping: Record<Faction, ProbeCode>;
    }
  | {
      kind: "probeDrawDiscard";
      drawFaction: Faction;
    }
  | {
      kind: "secretOrder";
      mapping: Record<SecretOrderWord, SingleColor>;
    }
  | {
      kind: "publicTextBlack";
      mandatoryDrawFaction: Faction;
    }
  | {
      kind: "publicTextColor";
    };

export interface PhysicalCard {
  /** 稳定实体牌 ID：照片编号 + 照片内位置。 */
  id: string;
  photo: 1 | 2 | 3 | 4 | 5 | 6;
  position: number;
  name:
    | "公开文本"
    | "试探"
    | "破译"
    | "烧毁"
    | "锁定"
    | "截获"
    | "掉包"
    | "离间"
    | "秘密下达"
    | "调虎离山"
    | "危险情报"
    | "识破"
    | "转移"
    | "增援"
    | "机密文件";
  color: CardColor;
  transmission: TransmissionMethod;
  /** true 表示牌面带方向圈，发送时选择顺时针或逆时针。 */
  circle: boolean;
  /** 实体牌是否印有“不可烧毁”标记；逐牌审计值，运行时不得按牌族推断。 */
  unburnable: boolean;
  variant?: CardVariant;
}

export const PHYSICAL_DECK = [
  {
    id: "p1-01",
    photo: 1,
    position: 1,
    name: "公开文本",
    color: "黑",
    transmission: "文本",
    circle: true,
    unburnable: false,
    variant: {
      kind: "publicTextBlack",
      mandatoryDrawFaction: "特工"
    }
  },
  {
    id: "p1-02",
    photo: 1,
    position: 2,
    name: "试探",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeIdentity",
      mapping: {
        "特工": "好人",
        "潜伏": "卧底",
        "军情": "间谍"
      }
    }
  },
  {
    id: "p1-03",
    photo: 1,
    position: 3,
    name: "破译",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p1-04",
    photo: 1,
    position: 4,
    name: "烧毁",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p1-05",
    photo: 1,
    position: 5,
    name: "锁定",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p1-06",
    photo: 1,
    position: 6,
    name: "截获",
    color: "蓝",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p1-07",
    photo: 1,
    position: 7,
    name: "截获",
    color: "红",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p1-08",
    photo: 1,
    position: 8,
    name: "公开文本",
    color: "黑",
    transmission: "文本",
    circle: true,
    unburnable: false,
    variant: {
      kind: "publicTextBlack",
      mandatoryDrawFaction: "军情"
    }
  },
  {
    id: "p1-09",
    photo: 1,
    position: 9,
    name: "公开文本",
    color: "蓝",
    transmission: "文本",
    circle: false,
    unburnable: false,
    variant: {
      kind: "publicTextColor"
    }
  },
  {
    id: "p1-10",
    photo: 1,
    position: 10,
    name: "掉包",
    color: "蓝",
    transmission: "文本",
    circle: true,
    unburnable: false,
  },
  {
    id: "p1-11",
    photo: 1,
    position: 11,
    name: "离间",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p1-12",
    photo: 1,
    position: 12,
    name: "秘密下达",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "黑",
        "看雨": "红",
        "日落": "蓝"
      }
    }
  },
  {
    id: "p2-01",
    photo: 2,
    position: 1,
    name: "调虎离山",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-02",
    photo: 2,
    position: 2,
    name: "掉包",
    color: "蓝",
    transmission: "文本",
    circle: true,
    unburnable: false,
  },
  {
    id: "p2-03",
    photo: 2,
    position: 3,
    name: "秘密下达",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "蓝",
        "看雨": "黑",
        "日落": "红"
      }
    }
  },
  {
    id: "p2-04",
    photo: 2,
    position: 4,
    name: "调虎离山",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-05",
    photo: 2,
    position: 5,
    name: "截获",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-06",
    photo: 2,
    position: 6,
    name: "危险情报",
    color: "黑",
    transmission: "任意",
    circle: true,
    unburnable: true,
  },
  {
    id: "p2-07",
    photo: 2,
    position: 7,
    name: "截获",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-08",
    photo: 2,
    position: 8,
    name: "锁定",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-09",
    photo: 2,
    position: 9,
    name: "锁定",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-10",
    photo: 2,
    position: 10,
    name: "识破",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-11",
    photo: 2,
    position: 11,
    name: "公开文本",
    color: "红",
    transmission: "文本",
    circle: false,
    unburnable: false,
    variant: {
      kind: "publicTextColor"
    }
  },
  {
    id: "p2-12",
    photo: 2,
    position: 12,
    name: "秘密下达",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "黑",
        "看雨": "红",
        "日落": "蓝"
      }
    }
  },
  {
    id: "p2-13",
    photo: 2,
    position: 13,
    name: "转移",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p2-14",
    photo: 2,
    position: 14,
    name: "锁定",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p2-15",
    photo: 2,
    position: 15,
    name: "离间",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-01",
    photo: 3,
    position: 1,
    name: "危险情报",
    color: "黑",
    transmission: "任意",
    circle: true,
    unburnable: true,
  },
  {
    id: "p3-02",
    photo: 3,
    position: 2,
    name: "识破",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-03",
    photo: 3,
    position: 3,
    name: "烧毁",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-04",
    photo: 3,
    position: 4,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "军情"
    }
  },
  {
    id: "p3-05",
    photo: 3,
    position: 5,
    name: "锁定",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: true,
  },
  {
    id: "p3-06",
    photo: 3,
    position: 6,
    name: "转移",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-07",
    photo: 3,
    position: 7,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "潜伏"
    }
  },
  {
    id: "p3-08",
    photo: 3,
    position: 8,
    name: "秘密下达",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "红",
        "看雨": "蓝",
        "日落": "黑"
      }
    }
  },
  {
    id: "p3-09",
    photo: 3,
    position: 9,
    name: "危险情报",
    color: "黑",
    transmission: "任意",
    circle: false,
    unburnable: true,
  },
  {
    id: "p3-10",
    photo: 3,
    position: 10,
    name: "调虎离山",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-11",
    photo: 3,
    position: 11,
    name: "烧毁",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-12",
    photo: 3,
    position: 12,
    name: "锁定",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-13",
    photo: 3,
    position: 13,
    name: "烧毁",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-14",
    photo: 3,
    position: 14,
    name: "烧毁",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p3-15",
    photo: 3,
    position: 15,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "特工"
    }
  },
  {
    id: "p4-01",
    photo: 4,
    position: 1,
    name: "秘密下达",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "黑",
        "看雨": "红",
        "日落": "蓝"
      }
    }
  },
  {
    id: "p4-02",
    photo: 4,
    position: 2,
    name: "试探",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeIdentity",
      mapping: {
        "特工": "卧底",
        "潜伏": "间谍",
        "军情": "好人"
      }
    }
  },
  {
    id: "p4-03",
    photo: 4,
    position: 3,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "潜伏"
    }
  },
  {
    id: "p4-04",
    photo: 4,
    position: 4,
    name: "公开文本",
    color: "黑",
    transmission: "文本",
    circle: true,
    unburnable: false,
    variant: {
      kind: "publicTextBlack",
      mandatoryDrawFaction: "潜伏"
    }
  },
  {
    id: "p4-05",
    photo: 4,
    position: 5,
    name: "秘密下达",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "红",
        "看雨": "蓝",
        "日落": "黑"
      }
    }
  },
  {
    id: "p4-06",
    photo: 4,
    position: 6,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "特工"
    }
  },
  {
    id: "p4-07",
    photo: 4,
    position: 7,
    name: "锁定",
    color: "蓝",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p4-08",
    photo: 4,
    position: 8,
    name: "试探",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeDrawDiscard",
      drawFaction: "军情"
    }
  },
  {
    id: "p4-09",
    photo: 4,
    position: 9,
    name: "识破",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p4-10",
    photo: 4,
    position: 10,
    name: "破译",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p4-11",
    photo: 4,
    position: 11,
    name: "截获",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p4-12",
    photo: 4,
    position: 12,
    name: "增援",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p4-13",
    photo: 4,
    position: 13,
    name: "破译",
    color: "蓝",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p4-14",
    photo: 4,
    position: 14,
    name: "机密文件",
    color: "红蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p4-15",
    photo: 4,
    position: 15,
    name: "危险情报",
    color: "黑",
    transmission: "任意",
    circle: true,
    unburnable: true,
  },
  {
    id: "p5-01",
    photo: 5,
    position: 1,
    name: "离间",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-02",
    photo: 5,
    position: 2,
    name: "转移",
    color: "蓝",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-03",
    photo: 5,
    position: 3,
    name: "试探",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "probeIdentity",
      mapping: {
        "特工": "间谍",
        "潜伏": "好人",
        "军情": "卧底"
      }
    }
  },
  {
    id: "p5-04",
    photo: 5,
    position: 4,
    name: "调虎离山",
    color: "蓝",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p5-05",
    photo: 5,
    position: 5,
    name: "调虎离山",
    color: "红",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p5-06",
    photo: 5,
    position: 6,
    name: "识破",
    color: "红",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p5-07",
    photo: 5,
    position: 7,
    name: "掉包",
    color: "红",
    transmission: "文本",
    circle: true,
    unburnable: false,
  },
  {
    id: "p5-08",
    photo: 5,
    position: 8,
    name: "离间",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-09",
    photo: 5,
    position: 9,
    name: "秘密下达",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "红",
        "看雨": "蓝",
        "日落": "黑"
      }
    }
  },
  {
    id: "p5-10",
    photo: 5,
    position: 10,
    name: "调虎离山",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p5-11",
    photo: 5,
    position: 11,
    name: "锁定",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-12",
    photo: 5,
    position: 12,
    name: "破译",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-13",
    photo: 5,
    position: 13,
    name: "危险情报",
    color: "黑",
    transmission: "任意",
    circle: false,
    unburnable: true,
  },
  {
    id: "p5-14",
    photo: 5,
    position: 14,
    name: "增援",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p5-15",
    photo: 5,
    position: 15,
    name: "机密文件",
    color: "红蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-01",
    photo: 6,
    position: 1,
    name: "识破",
    color: "蓝",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-02",
    photo: 6,
    position: 2,
    name: "破译",
    color: "红",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-03",
    photo: 6,
    position: 3,
    name: "截获",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-04",
    photo: 6,
    position: 4,
    name: "破译",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-05",
    photo: 6,
    position: 5,
    name: "掉包",
    color: "黑",
    transmission: "文本",
    circle: false,
    unburnable: true,
  },
  {
    id: "p6-06",
    photo: 6,
    position: 6,
    name: "增援",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-07",
    photo: 6,
    position: 7,
    name: "识破",
    color: "黑",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-08",
    photo: 6,
    position: 8,
    name: "机密文件",
    color: "红蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-09",
    photo: 6,
    position: 9,
    name: "秘密下达",
    color: "黑",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "蓝",
        "看雨": "黑",
        "日落": "红"
      }
    }
  },
  {
    id: "p6-10",
    photo: 6,
    position: 10,
    name: "掉包",
    color: "红",
    transmission: "文本",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-11",
    photo: 6,
    position: 11,
    name: "秘密下达",
    color: "蓝",
    transmission: "直达",
    circle: false,
    unburnable: false,
    variant: {
      kind: "secretOrder",
      mapping: {
        "听风": "蓝",
        "看雨": "黑",
        "日落": "红"
      }
    }
  },
  {
    id: "p6-12",
    photo: 6,
    position: 12,
    name: "离间",
    color: "红",
    transmission: "直达",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-13",
    photo: 6,
    position: 13,
    name: "转移",
    color: "黑",
    transmission: "密电",
    circle: false,
    unburnable: false,
  },
  {
    id: "p6-14",
    photo: 6,
    position: 14,
    name: "锁定",
    color: "红",
    transmission: "密电",
    circle: true,
    unburnable: false,
  },
  {
    id: "p6-15",
    photo: 6,
    position: 15,
    name: "转移",
    color: "红",
    transmission: "密电",
    circle: false,
    unburnable: false,
  }
] as const satisfies readonly PhysicalCard[];

export type PhysicalCardId = (typeof PHYSICAL_DECK)[number]["id"];

export const EXPECTED_DECK_TOTALS = {
  cards: 87,
  circles: 28,
  colors: {
    红: 21,
    蓝: 21,
    黑: 42,
    红蓝: 3,
  },
  transmissions: {
    密电: 41,
    文本: 10,
    直达: 31,
    任意: 5,
  },
  families: {
    公开文本: 5,
    试探: 9,
    破译: 6,
    烧毁: 5,
    锁定: 9,
    截获: 6,
    掉包: 5,
    离间: 5,
    秘密下达: 9,
    调虎离山: 6,
    危险情报: 5,
    识破: 6,
    转移: 5,
    增援: 3,
    机密文件: 3,
  },
} as const;

/**
 * 在测试或启动阶段调用。若清单被误改，会立即报出具体不一致项。
 */
export function assertPhysicalDeckIntegrity(
  deck: readonly PhysicalCard[] = PHYSICAL_DECK,
): void {
  const fail = (message: string): never => {
    throw new Error(`牌组清单校验失败：${message}`);
  };

  if (deck.length !== EXPECTED_DECK_TOTALS.cards) {
    fail(`总牌数应为 ${EXPECTED_DECK_TOTALS.cards}，实际为 ${deck.length}`);
  }

  const ids = new Set<string>();
  const colors = new Map<CardColor, number>();
  const transmissions = new Map<TransmissionMethod, number>();
  const families = new Map<PhysicalCard["name"], number>();
  let circles = 0;

  for (const card of deck) {
    if (ids.has(card.id)) fail(`实体牌 ID 重复：${card.id}`);
    ids.add(card.id);

    colors.set(card.color, (colors.get(card.color) ?? 0) + 1);
    transmissions.set(
      card.transmission,
      (transmissions.get(card.transmission) ?? 0) + 1,
    );
    families.set(card.name, (families.get(card.name) ?? 0) + 1);
    if (card.circle) circles += 1;

    if (card.name === "机密文件" && card.color !== "红蓝") {
      fail(`${card.id} 机密文件必须是红蓝双色`);
    }
    if (card.name !== "机密文件" && card.color === "红蓝") {
      fail(`${card.id} 只有机密文件可以是红蓝双色`);
    }
    if (card.name === "危险情报" && card.transmission !== "任意") {
      fail(`${card.id} 危险情报必须使用任意传递方式`);
    }
    if (card.name === "秘密下达" && card.variant?.kind !== "secretOrder") {
      fail(`${card.id} 秘密下达缺少词语—颜色映射`);
    }
    if (card.name === "试探" && !card.variant?.kind.startsWith("probe")) {
      fail(`${card.id} 试探缺少具体版本`);
    }
  }

  if (circles !== EXPECTED_DECK_TOTALS.circles) {
    fail(`带圈牌应为 ${EXPECTED_DECK_TOTALS.circles}，实际为 ${circles}`);
  }

  for (const [color, expected] of Object.entries(
    EXPECTED_DECK_TOTALS.colors,
  ) as [CardColor, number][]) {
    const actual = colors.get(color) ?? 0;
    if (actual !== expected) fail(`${color}牌应为 ${expected}，实际为 ${actual}`);
  }

  for (const [method, expected] of Object.entries(
    EXPECTED_DECK_TOTALS.transmissions,
  ) as [TransmissionMethod, number][]) {
    const actual = transmissions.get(method) ?? 0;
    if (actual !== expected) {
      fail(`${method}牌应为 ${expected}，实际为 ${actual}`);
    }
  }

  for (const [name, expected] of Object.entries(
    EXPECTED_DECK_TOTALS.families,
  ) as [PhysicalCard["name"], number][]) {
    const actual = families.get(name) ?? 0;
    if (actual !== expected) fail(`${name}应为 ${expected}，实际为 ${actual}`);
  }
}
