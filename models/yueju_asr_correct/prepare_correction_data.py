"""生成越剧语音识别术语纠错训练集。

数据由人工校验的越剧专名易错映射、场景模板和保守的“无需修改”样本组成。
输出为 Alpaca JSON，供 train_corrector.py 使用。
"""

from __future__ import annotations

import json
import random
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
TRAIN_PATH = DATA_DIR / "correction_train.json"
EVAL_PATH = DATA_DIR / "correction_eval.json"
SEED = 20260802

SYSTEM_PROMPT = (
    "你是越剧语音识别文本纠错助手。只纠正越剧专有名词、同音字、错别字和明显的断句错误，"
    "不得改写原意，不得补充原文没有的信息。只输出纠正后的完整文本。"
)

INSTRUCTIONS = [
    "纠正下面这段越剧语音识别文本，只输出纠正结果。",
    "请修正文本中的越剧专名和同音错字，不要解释。",
    "校正以下转写文本，保持原意和句式不变。",
    "这是一段越剧相关语音转写，请只返回纠正后的文本。",
]

# 正确词 -> 常见 ASR 同音/近音误识别。映射均用于合成输入，输出始终保留正确词。
TERM_GROUPS: dict[str, dict[str, list[str]]] = {
    "流派": {
        "袁派": ["原派", "元派"],
        "尹派": ["引派", "银派"],
        "范派": ["饭派", "泛派"],
        "傅派": ["付派", "副派"],
        "徐派": ["许派", "续派"],
        "戚派": ["齐派", "七派"],
        "王派": ["汪派"],
        "陆派": ["路派"],
        "毕派": ["笔派", "必派"],
        "吕派": ["旅派", "铝派"],
        "金派": ["京派"],
        "张派": ["章派"],
    },
    "名家": {
        "袁雪芬": ["元雪芬", "袁雪分"],
        "尹桂芳": ["尹贵芳", "尹桂方"],
        "范瑞娟": ["范瑞鹃", "范瑞卷"],
        "傅全香": ["付全香", "傅泉香"],
        "徐玉兰": ["徐玉蓝", "许玉兰"],
        "王文娟": ["王文鹃", "王文卷"],
        "戚雅仙": ["齐雅仙", "戚亚仙"],
        "毕春芳": ["笔春芳", "毕春方"],
        "陆锦花": ["路锦花", "陆金花"],
        "吕瑞英": ["旅瑞英", "吕锐英"],
        "金采风": ["金彩凤", "金彩风"],
        "张桂凤": ["张贵凤", "章桂凤"],
        "竺水招": ["竹水招", "竺水昭"],
        "施银花": ["石银花", "施银华"],
    },
    "剧目": {
        "梁山伯与祝英台": ["梁山泊与祝英台", "梁山伯与祝应台"],
        "红楼梦": ["红楼孟", "红楼蒙"],
        "祥林嫂": ["祥林扫", "香林嫂"],
        "西厢记": ["西乡记", "西香记"],
        "碧玉簪": ["碧玉赞", "壁玉簪"],
        "何文秀": ["何闻秀", "何文绣"],
        "北地王": ["北帝王", "北第王"],
        "五女拜寿": ["舞女拜寿", "五女白寿"],
        "打金枝": ["打京枝", "打金支"],
        "孔雀东南飞": ["孔鹊东南飞"],
        "柳毅传书": ["柳意传书", "刘毅传书"],
        "沙漠王子": ["沙莫王子"],
        "珍珠塔": ["真珠塔"],
        "玉堂春": ["玉唐春"],
        "盘夫索夫": ["盘扶索夫", "盘夫锁夫"],
        "情探": ["晴探"],
        "追鱼": ["锥鱼"],
    },
    "唱段": {
        "十八相送": ["十八乡送", "十八项送"],
        "天上掉下个林妹妹": ["天上掉下个林美美", "天上掉下个林妹没"],
        "我家有个小九妹": ["我家有个小酒妹", "我家有个小玖妹"],
        "黛玉葬花": ["黛玉藏花", "代玉葬花"],
        "金玉良缘": ["金玉良言"],
        "读西厢": ["读西乡"],
        "哭灵": ["哭林"],
        "楼台会": ["楼台汇"],
    },
    "唱腔": {
        "四工调": ["四宫调", "四公调"],
        "尺调": ["迟调", "吃掉"],
        "弦下调": ["闲下调", "弦夏调"],
        "嚣板": ["消板", "箫板"],
        "清板": ["轻板"],
        "流水板": ["流水版"],
        "起腔": ["启腔"],
        "落腔": ["洛腔"],
        "润腔": ["闰腔"],
        "甩腔": ["帅腔"],
    },
    "表演": {
        "水袖": ["水秀", "水绣"],
        "台步": ["抬步"],
        "云手": ["匀手"],
        "圆场": ["原场", "园场"],
        "身段": ["声段"],
        "兰花指": ["蓝花指"],
        "小生": ["小声"],
        "花旦": ["花担", "划单"],
        "青衣": ["轻衣"],
        "老旦": ["老蛋"],
        "丑角": ["抽角"],
    },
    "历史": {
        "越剧": ["粤剧", "岳剧"],
        "嵊州": ["盛州", "圣州"],
        "嵊县": ["盛县", "胜县"],
        "小歌班": ["小哥班"],
        "的笃班": ["得笃班", "的督班"],
        "落地唱书": ["落地藏书", "落地唱术"],
        "女子越剧": ["女子粤剧"],
        "越剧十姐妹": ["越剧十姊妹", "粤剧十姐妹"],
        "国家级非物质文化遗产": ["国家级非物资文化遗产"],
    },
}

TEMPLATES = {
    "流派": [
        "老师正在讲解{term}的唱腔特色。",
        "这段唱腔具有鲜明的{term}风格。",
        "我想学习{term}的发声和润腔方法。",
        "请播放一段经典的{term}唱段。",
    ],
    "名家": [
        "今天的课程介绍了越剧名家{term}。",
        "这段珍贵录音由{term}演唱。",
        "我想了解{term}的艺术生涯。",
        "老师分析了{term}的表演特色。",
    ],
    "剧目": [
        "今晚剧场上演越剧《{term}》。",
        "我们正在学习《{term}》的剧情和唱段。",
        "《{term}》是观众熟悉的越剧剧目。",
        "请介绍越剧《{term}》的主要人物。",
    ],
    "唱段": [
        "接下来练习经典唱段《{term}》。",
        "我最喜欢听《{term}》这一段。",
        "老师逐句讲解了《{term}》的唱词。",
        "请帮我找到《{term}》的示范录音。",
    ],
    "唱腔": [
        "这段唱腔主要采用{term}。",
        "老师示范了{term}的运腔方法。",
        "练习{term}时要注意气息和咬字。",
        "这一句从{term}开始处理。",
    ],
    "表演": [
        "今天的形体课练习{term}。",
        "演员的{term}表演很有韵味。",
        "老师正在示范越剧{term}的动作要领。",
        "学习{term}需要注意手眼身法步。",
    ],
    "历史": [
        "今天我们学习{term}的历史。",
        "讲座中提到了{term}这一重要概念。",
        "这段资料介绍了{term}的发展过程。",
        "请准确记录术语{term}。",
    ],
}


def make_record(noisy: str, correct: str, instruction: str) -> dict[str, str]:
    return {
        "system": SYSTEM_PROMPT,
        "instruction": instruction,
        "input": noisy,
        "output": correct,
    }


def build_examples() -> list[dict[str, str]]:
    rng = random.Random(SEED)
    pairs: list[tuple[str, str]] = []
    correct_sentences: list[str] = []

    for group, terms in TERM_GROUPS.items():
        for correct_term, noisy_terms in terms.items():
            for template in TEMPLATES[group]:
                correct = template.format(term=correct_term)
                correct_sentences.append(correct)
                for noisy_term in noisy_terms:
                    pairs.append((template.format(term=noisy_term), correct))
                    # 脱离固定模板的短上下文，强化“术语本身”的映射能力。
                    pairs.append((f"越剧课上提到{noisy_term}。", f"越剧课上提到{correct_term}。"))
                    pairs.append((f"请把术语{noisy_term}记录下来。", f"请把术语{correct_term}记录下来。"))

    # 多术语同时误识别，训练模型处理真实长句中的多个错误。
    flattened = [
        (group, correct, noisy)
        for group, terms in TERM_GROUPS.items()
        for correct, noisy_list in terms.items()
        for noisy in noisy_list
    ]
    for _ in range(260):
        picked = rng.sample(flattened, 3)
        correct_terms = [item[1] for item in picked]
        noisy_terms = [item[2] for item in picked]
        correct = f"今天的越剧课提到了{correct_terms[0]}、《{correct_terms[1]}》和{correct_terms[2]}。"
        noisy = f"今天的粤剧课提到了{noisy_terms[0]}、《{noisy_terms[1]}》和{noisy_terms[2]}。"
        pairs.append((noisy, correct))

    # 保守样本：没有错误时必须原样输出，防止模型过度改写。
    rng.shuffle(correct_sentences)
    for sentence in correct_sentences[:180]:
        pairs.append((sentence, sentence))

    # 常见完整句和断句样本。
    pairs.extend([
        ("越剧发源于浙江盛州前身是落地藏书", "越剧发源于浙江嵊州，前身是落地唱书。"),
        ("小哥班后来发展成女子粤剧", "小歌班后来发展成女子越剧。"),
        ("元雪芬是越剧十姊妹之一", "袁雪芬是越剧十姐妹之一。"),
        ("请介绍一下元雪芬的原派唱腔特色。", "请介绍一下袁雪芬的袁派唱腔特色。"),
        ("我想听范瑞鹃演唱的梁山泊与祝应台。", "我想听范瑞娟演唱的《梁山伯与祝英台》。"),
        ("老师示范了吃掉的运腔方法。", "老师示范了尺调的运腔方法。"),
        ("梁山泊与祝应台中的十八乡送很经典", "《梁山伯与祝英台》中的《十八相送》很经典。"),
        ("徐玉蓝和王文鹃主演的红楼孟影响很大", "徐玉兰和王文娟主演的《红楼梦》影响很大。"),
        ("四宫调尺调和闲下调都是越剧常用腔调", "四工调、尺调和弦下调都是越剧常用腔调。"),
        ("水秀台步匀手原场都属于越剧身段训练", "水袖、台步、云手、圆场都属于越剧身段训练。"),
        ("今天学习袁派和尹派的唱腔区别。", "今天学习袁派和尹派的唱腔区别。"),
        ("《红楼梦》是越剧经典剧目。", "《红楼梦》是越剧经典剧目。"),
        ("请保持这句话原样不变。", "请保持这句话原样不变。"),
    ])

    unique_pairs = list(dict.fromkeys(pairs))
    rng.shuffle(unique_pairs)
    return [
        make_record(noisy, correct, INSTRUCTIONS[index % len(INSTRUCTIONS)])
        for index, (noisy, correct) in enumerate(unique_pairs)
    ]


def main() -> None:
    examples = build_examples()
    rng = random.Random(SEED)
    rng.shuffle(examples)
    eval_size = max(80, round(len(examples) * 0.1))
    eval_data = examples[:eval_size]
    train_data = examples[eval_size:]

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    TRAIN_PATH.write_text(json.dumps(train_data, ensure_ascii=False, indent=2), encoding="utf-8")
    EVAL_PATH.write_text(json.dumps(eval_data, ensure_ascii=False, indent=2), encoding="utf-8")

    changed = sum(item["input"] != item["output"] for item in examples)
    unchanged = len(examples) - changed
    print(f"训练集: {len(train_data)} -> {TRAIN_PATH}")
    print(f"验证集: {len(eval_data)} -> {EVAL_PATH}")
    print(f"纠错样本: {changed}，保守样本: {unchanged}")


if __name__ == "__main__":
    main()
