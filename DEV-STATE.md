# 寮€鍙戠姸鎬侊紙鎺ョ画绗旇锛?
> 浠讳綍涓€娆?dsh web 閲嶅惎鎴栦笂涓嬫枃鍘嬬缉涔嬪悗锛屽厛璇昏繖涓枃浠跺嵆鍙帴缁伐浣溿€?
## 褰撳墠鐗堟湰

- 鐗堟湰 0.2.0 锝?鏈湴 git 浠撳簱锛坄git log --oneline -1` 鐪嬫渶鏂版彁浜わ級
- 宸插畨瑁呬负 profile link锛歚dsh plugin --profile web add link:C:/Users/20549/.dsh/plugins/dsh-auto-translate`
- 鐢熸晥鏂瑰紡锛氭敼瀹?`index.js` 鎴?`client.js` 蹇呴』**閲嶅惎 dsh web**锛沗vendor/` 涓嬬殑鏂囦欢鏄繍琛屾椂鎸夐渶鍔犺浇锛屾敼鍔ㄦ棤闇€閲嶅惎

## 鍏抽敭璺緞

| 浣滅敤 | 璺緞 |
| --- | --- |
| 瀹夸富鍗婏紙璺敱 / 妯″瀷浠ｇ悊 / 璇婃柇锛?| `index.js` |
| 娴忚鍣ㄥ崐锛堟壂鎻?/ 缈昏瘧 / 鎮仠 / 闈㈡澘锛?| `client.js` |
| 鎺ㄧ悊 Worker锛圵ASM锛?| `vendor/worker.v5.js` |
| 鍐呯疆搴擄紙transformers 娴忚鍣?ESM锛?| `vendor/transformers.esm.v2.js` |
| ORT 杩愯鏃讹紙loader 鍏ュ簱锛寃asm 璧?CDN 鍏滃簳锛?| `vendor/ort/` |
| 瀹夸富妯″瀷纾佺洏缂撳瓨 | `$DSH_HOME/dsh-auto-translate/models`锛堢害 860MB锛?|
| 瀹夸富 ORT 鍏滃簳缂撳瓨 | `$DSH_HOME/dsh-auto-translate/ort-cache` |
| 璇婃柇钀界洏 | `$DSH_HOME/dsh-auto-translate/diagnose-*.json`锛堝彧鐣欐渶杩?20 浠斤級 |
| 閲嶅惎鑴氭湰 | `C:/Users/20549/.dsh/restart-dsh-web.ps1` |
| 淇濋櫓閲嶅惎锛圫HA 姣斿锛屽箓绛夛級 | `C:/Users/20549/.dsh/restart-guard.ps1` |

## 甯哥敤鍛戒护

    cd C:\Users\20549\.dsh\plugins\dsh-auto-translate
    npm test              # 9 椤圭绾挎祴璇曪細濂戠害 + i18n 瀹屾暣鎬?    npm run fetch-vendor  # 閲嶅缓 vendor/锛堟崲鏈哄櫒鎴栬瀹屽叏绂荤嚎鏃讹級
    git log --oneline -5

## 閲嶅惎鐨勬纭Э鍔匡紙韪╄繃鐨勫潙锛?
- 鐩存帴鐢ㄥ墠鍙?pwsh 鎴?Start-Process 璺戦噸鍚剼鏈紝鑴氭湰浼氬湪鏉€鎺夋湇鍔″悗琚繛甯︽潃姝伙紙鏃ュ織鍙仠鍦?`script PID`锛夈€?- 鍙潬鍋氭硶锛氱敤璁″垝浠诲姟璋冪敤 `restart-guard.ps1` 鈥斺€?瀹冨彧鍦ㄣ€屾湇鍔¤繘绋嬪惎鍔ㄦ椂闂?< 鎻掍欢鏂囦欢淇敼鏃堕棿銆嶆椂鎵嶉噸鍚紝澶╃劧骞傜瓑銆?
## 鐜扮姸涓庡凡鐭ラ檺鍒?
- 璇悜锛歟n鈫攝h 鐢?fp32 骞插噣鍥撅紙绾?425MB锛夛紱ja/ko 绛夆啋zh 璧?NLLB 600M锛堟寜闇€ 600MB锛?- 閲忓寲鍙樹綋锛坕nt8 / uint8 / q8 / q4 / bnb4锛夊湪鏈満 ONNX Runtime 涓婁細瑙﹀彂
  `TransposeDQWeightsForMatMulNBits Missing required scale`锛屽洜姝?*鍒绘剰鍙敤 fp32**
- 妯″瀷 revision 宸查攣 sha锛岃 `vendor/worker.v5.js` 閲岀殑 `REVISIONS`
- 鍦ㄧ嚎寮曟搸 MyMemory 鏈夋瘡鏃ラ搴︼紙鍙兘 429锛夛紱绔晶 Translator 闇€杩?Google 缁勪欢鏈嶅姟鍣紙鏈綉缁滀笉鍙敤锛?
## 涓嬩竴姝ュ€欓€?
1. jsdom 绾?E2E锛氱炕璇?鈫?鎮仠鍒囨崲 鈫?瑙傚療鑰呬笉瑕嗙洊锛堢洰鍓嶅彧鍒扮函鍑芥暟绾э級
2. 闈㈡澘宸蹭腑鑻卞弻璇紱README 涓庤瘖鏂枃鏈彲鍐嶇粏鍖栬嫳鏂?3. 鍙戠増锛氬缓 GitHub 浠撳簱 鈫?鍔犺瘽棰?`dsh-plugin` 鈫?鍙€?npm publish锛堣 README锛?
